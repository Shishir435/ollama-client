/**
 * A packaged extension in a real Chromium, with a killable service worker.
 *
 * Playwright auto-attaches to extension service workers and pins them alive,
 * so a runner that needs to watch a worker die cannot use it. Chromium is
 * launched directly instead, only an extension page is attached to, and the
 * worker is terminated through DevTools `/json/close` — which leaves the
 * extension page and the offscreen SQLite owner running, so what is measured
 * is a worker restart rather than a browser restart.
 *
 * Shared by every runner that needs that topology. The mechanics are the same
 * whatever is being recovered; only the verbs the page is asked for differ,
 * and a second copy of the launch dance would be a second place for the
 * worker-detection or the teardown to drift.
 */

import { spawn } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { chromium } from "playwright"

export interface CdpTarget {
  id: string
  type: string
  url: string
}

export interface GateResult {
  gate: string
  pass: boolean
  detail: Record<string, unknown>
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolvePause) => setTimeout(resolvePause, ms))

export const poll = async <T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  description: string,
  timeoutMs = 30_000
): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  let lastValue: T | undefined
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      lastValue = await read()
      if (accept(lastValue)) return lastValue
    } catch (error) {
      lastError = error
    }
    await sleep(150)
  }
  throw new Error(
    `Timed out waiting for ${description}: ${JSON.stringify(lastValue ?? null)}${
      lastError ? ` (${String(lastError)})` : ""
    }`
  )
}

/** One attached extension page, driven by `Runtime.evaluate` and nothing else. */
export class PageSession {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private sessionId = ""

  private constructor(ws: WebSocket) {
    this.ws = ws
  }

  static async open(browserWsUrl: string, url: string): Promise<PageSession> {
    const ws = new WebSocket(browserWsUrl)
    await new Promise<void>((resolveOpen, rejectOpen) => {
      ws.addEventListener("open", () => resolveOpen(), { once: true })
      ws.addEventListener(
        "error",
        () => rejectOpen(new Error("browser websocket failed")),
        { once: true }
      )
    })
    const page = new PageSession(ws)
    ws.addEventListener("message", (event) =>
      page.onMessage(String(event.data))
    )
    const created = (await page.sendBrowser("Target.createTarget", {
      url
    })) as { targetId: string }
    const attached = (await page.sendBrowser("Target.attachToTarget", {
      targetId: created.targetId,
      flatten: true
    })) as { sessionId: string }
    page.sessionId = attached.sessionId
    await page.send("Runtime.enable")
    return page
  }

  private onMessage(data: string): void {
    const message = JSON.parse(data) as {
      id?: number
      result?: unknown
      error?: { message: string }
    }
    if (typeof message.id !== "number") return
    const waiter = this.pending.get(message.id)
    if (!waiter) return
    this.pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result)
  }

  private raw(payload: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolvePending, rejectPending) => {
      this.pending.set(id, {
        resolve: resolvePending,
        reject: rejectPending
      })
      this.ws.send(JSON.stringify({ id, ...payload }))
    })
  }

  private sendBrowser(method: string, params?: unknown): Promise<unknown> {
    return this.raw({ method, params })
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    return this.raw({ method, params, sessionId: this.sessionId })
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    })) as {
      result: { value?: T }
      exceptionDetails?: { exception?: { description?: string }; text?: string }
    }
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "page evaluation failed"
      )
    }
    return result.result.value as T
  }

  close(): void {
    this.ws.close()
  }
}

/** Calls a `window.__persistenceVerify` hook on the attached page. */
export const verifyCall = (method: string, ...args: unknown[]): string =>
  `window.__persistenceVerify[${JSON.stringify(method)}](...${JSON.stringify(args)})`

export interface ExtensionHarness {
  /** The extension's own id, read from the worker's URL. */
  extensionId: string
  /** The worker running when the harness came up. */
  originalWorker: CdpTarget
  page: PageSession
  listTargets(): Promise<CdpTarget[]>
  findServiceWorker(targets: CdpTarget[]): CdpTarget | undefined
  httpJson(path: string): Promise<unknown>
}

const serviceWorkerIn = (targets: CdpTarget[]): CdpTarget | undefined =>
  targets.find(
    (target) =>
      target.type === "service_worker" && target.url.endsWith("/background.js")
  )

/**
 * Launches Chromium on a packaged build, attaches the named extension page,
 * runs `body`, and tears the browser down whatever happened.
 */
export const withExtensionHarness = async (input: {
  buildPath: string
  page: string
  body: (harness: ExtensionHarness) => Promise<void>
}): Promise<void> => {
  const userDataDir = mkdtempSync(`${tmpdir()}/ollama-client-sw-`)
  const chromiumArgs = [
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${input.buildPath}`,
    `--disable-extensions-except=${input.buildPath}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check"
  ]
  if (process.platform === "linux") {
    chromiumArgs.push("--disable-dev-shm-usage")
  }
  if (process.env.CI) chromiumArgs.push("--no-sandbox")
  if (process.env.E2E_HEADFUL !== "1") chromiumArgs.push("--headless=new")
  const child = spawn(chromium.executablePath(), chromiumArgs, {
    stdio: ["ignore", "ignore", "pipe"]
  })
  let browserFailure = ""
  let browserStderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    browserStderr = `${browserStderr}${chunk}`.slice(-4_000)
  })
  child.once("error", (error) => {
    browserFailure = `spawn error: ${error.message}`
  })
  child.once("exit", (code, signal) => {
    browserFailure = `exited code=${String(code)} signal=${String(signal)}`
  })
  let page: PageSession | undefined
  let debugPort = 0
  const httpJson = async (path: string): Promise<unknown> => {
    const response = await fetch(`http://127.0.0.1:${debugPort}${path}`)
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  const listTargets = async (): Promise<CdpTarget[]> => {
    const value = await httpJson("/json/list")
    return Array.isArray(value) ? (value as CdpTarget[]) : []
  }

  try {
    const activePortFile = resolve(userDataDir, "DevToolsActivePort")
    const launchState = await poll(
      async () => {
        if (browserFailure) return { port: 0, failure: browserFailure }
        try {
          return {
            port: Number.parseInt(readFileSync(activePortFile, "utf8"), 10),
            failure: ""
          }
        } catch {
          return { port: 0, failure: "" }
        }
      },
      (state) =>
        Boolean(state.failure) ||
        (Number.isInteger(state.port) && state.port > 0),
      "Chromium debugging port"
    )
    if (launchState.failure) {
      throw new Error(
        `Chromium failed before reporting its debugging port: ${launchState.failure}\n${browserStderr}`
      )
    }
    debugPort = launchState.port

    const browserWsUrl = await poll(
      async () => {
        try {
          return (await httpJson("/json/version")) as {
            webSocketDebuggerUrl?: string
          }
        } catch {
          return {}
        }
      },
      (version) => Boolean(version.webSocketDebuggerUrl),
      "Chromium DevTools endpoint"
    ).then((version) => version.webSocketDebuggerUrl as string)

    const originalWorker = await poll(
      async () => serviceWorkerIn(await listTargets()),
      (target) => Boolean(target),
      "extension service worker"
    )
    if (!originalWorker) {
      throw new Error("Extension service worker disappeared before test start")
    }
    const extensionId = new URL(originalWorker.url).host
    page = await PageSession.open(
      browserWsUrl,
      `chrome-extension://${extensionId}/${input.page}`
    )
    const attached = page
    await poll(
      () => attached.evaluate("typeof window.__persistenceVerify === 'object'"),
      Boolean,
      "persistence verification hooks"
    )
    await input.body({
      extensionId,
      originalWorker,
      page: attached,
      listTargets,
      findServiceWorker: serviceWorkerIn,
      httpJson
    })
  } finally {
    page?.close()
    child.kill("SIGKILL")
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        rmSync(userDataDir, { recursive: true, force: true })
        break
      } catch {
        await sleep(200)
      }
    }
  }
}

/** Writes the runner's own report and sets the exit code from its gates. */
export const reportGates = (input: {
  artifactDir: string
  name: string
  gate: string
  topology: string
  results: readonly GateResult[]
}): void => {
  const report = {
    measuredAt: new Date().toISOString(),
    gate: input.gate,
    topology: input.topology,
    results: input.results
  }
  mkdirSync(input.artifactDir, { recursive: true })
  const outputPath = resolve(
    input.artifactDir,
    `${input.name}-${Date.now()}.json`
  )
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  console.error(`Report written: ${outputPath}`)
  console.log(JSON.stringify(report, null, 2))
  if (input.results.some((result) => !result.pass)) process.exitCode = 1
}

export const gateRecorder =
  (results: GateResult[]) =>
  (gate: string, pass: boolean, detail: Record<string, unknown>): void => {
    results.push({ gate, pass, detail })
    console.error(`${pass ? "PASS" : "FAIL"} ${gate}`)
    if (!pass) console.error(JSON.stringify(detail, null, 2))
  }
