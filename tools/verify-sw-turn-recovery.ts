#!/usr/bin/env node

/**
 * End-to-end durable-turn recovery after isolated MV3 service-worker loss.
 *
 * Playwright auto-attaches to extension service workers and pins them alive, so
 * this runner launches Chromium directly, attaches only to an extension page,
 * and terminates the worker through DevTools /json/close. The extension page
 * and offscreen SQLite owner remain alive while a fresh worker resumes the
 * generating turn through the real stream port and persistence paths.
 *
 * Usage: pnpm verify:sw-turn-recovery
 * Requires: pnpm benchmark:build
 */

import { spawn } from "node:child_process"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
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

const buildPath = resolve("build/chrome-mv3-benchmark")
const artifactDir = resolve("artifacts/e2e")

interface CdpTarget {
  id: string
  type: string
  url: string
}

interface GateResult {
  gate: string
  pass: boolean
  detail: Record<string, unknown>
}

interface TurnResult {
  status?: string
  content?: string
  done?: boolean
}

const results: GateResult[] = []
let debugPort = 0

const record = (
  gate: string,
  pass: boolean,
  detail: Record<string, unknown>
): void => {
  results.push({ gate, pass, detail })
  console.error(`${pass ? "PASS" : "FAIL"} ${gate}`)
  if (!pass) console.error(JSON.stringify(detail, null, 2))
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolvePause) => setTimeout(resolvePause, ms))

const poll = async <T>(
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
    await sleep(200)
  }
  throw new Error(
    `${description} timed out; last value=${JSON.stringify(lastValue)}; last error=${String(lastError ?? "none")}`
  )
}

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

const findServiceWorker = (targets: CdpTarget[]): CdpTarget | undefined =>
  targets.find(
    (target) =>
      target.type === "service_worker" && target.url.endsWith("/background.js")
  )

class PageSession {
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
    ws.addEventListener("message", (event) => page.onMessage(String(event.data)))
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

const verifyCall = (method: string, ...args: unknown[]): string =>
  `window.__persistenceVerify[${JSON.stringify(method)}](...${JSON.stringify(args)})`

const startFakeOllama = async () => {
  const prompt = "isolated worker loss e2e"
  let calls = 0
  const pending = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Content-Type", "application/json")
    if (request.url === "/api/tags") {
      response.end(
        JSON.stringify({
          models: [
            {
              name: "verify-model",
              model: "verify-model",
              modified_at: new Date(0).toISOString(),
              size: 1,
              digest: "verify",
              details: { family: "verify", families: ["verify"] }
            }
          ]
        })
      )
      return
    }
    if (request.url === "/api/show") {
      response.end(
        JSON.stringify({
          capabilities: ["completion"],
          details: { family: "verify" }
        })
      )
      return
    }
    if (request.url === "/api/chat") {
      for await (const _chunk of request) {
        // Drain request before responding.
      }
      calls += 1
      response.setHeader("Content-Type", "application/x-ndjson")
      if (calls === 1) {
        response.write(
          `${JSON.stringify({ message: { content: "before-worker-kill " }, done: false })}\n`
        )
        const timer = setTimeout(() => {
          pending.delete(timer)
          if (!response.destroyed) {
            response.end(
              `${JSON.stringify({ message: { content: "stale" }, done: true })}\n`
            )
          }
        }, 30_000)
        pending.add(timer)
        return
      }
      response.end(
        `${JSON.stringify({ message: { content: "recovered" }, done: false })}\n${JSON.stringify({ message: { content: "" }, done: true })}\n`
      )
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    prompt,
    calls: () => calls,
    close: () =>
      new Promise<void>((resolveClose) => {
        for (const timer of pending) clearTimeout(timer)
        pending.clear()
        server.close(() => resolveClose())
        server.closeAllConnections()
      })
  }
}

const run = async (): Promise<void> => {
  const userDataDir = mkdtempSync(`${tmpdir()}/ollama-client-sw-turn-`)
  const fakeOllama = await startFakeOllama()
  const chromiumArgs = [
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${buildPath}`,
    `--disable-extensions-except=${buildPath}`,
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

  try {
    const activePortFile = resolve(userDataDir, "DevToolsActivePort")
    const launchState = await poll(
      async () => {
        if (browserFailure) {
          return { port: 0, failure: browserFailure }
        }
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

    const originalWorkerCandidate = await poll(
      async () => findServiceWorker(await listTargets()),
      (target) => Boolean(target),
      "extension service worker"
    )
    if (!originalWorkerCandidate) {
      throw new Error("Extension service worker disappeared before test start")
    }
    const originalWorker = originalWorkerCandidate
    const extensionId = new URL(originalWorker.url).host
    page = await PageSession.open(
      browserWsUrl,
      `chrome-extension://${extensionId}/persistence-verify.html`
    )
    await poll(
      () => page?.evaluate("typeof window.__persistenceVerify === 'object'") ?? Promise.resolve(false),
      Boolean,
      "persistence verification hooks"
    )
    await poll(
      () =>
        page?.evaluate<{ backend?: string } | null>(verifyCall("backendMarker")) ??
        Promise.resolve(null),
      (marker) => marker?.backend === "opfs",
      "OPFS backend marker"
    )

    await page.evaluate(verifyCall("configureFakeOllama", fakeOllama.baseUrl))
    const turnId = "verify-isolated-sw-loss"
    const assistantMessageId = await page.evaluate<number>(
      verifyCall("startDurableTurn", turnId, fakeOllama.prompt)
    )
    const beforeKill = await poll(
      () =>
        page?.evaluate<TurnResult>(
          verifyCall("durableTurnResult", turnId, assistantMessageId)
        ) ?? Promise.resolve<TurnResult>({}),
      (result) =>
        result.status === "generating" &&
        result.content === "before-worker-kill ",
      "first streamed chunk"
    )
    record("isolated-sw-turn-started", fakeOllama.calls() === 1, {
      calls: fakeOllama.calls(),
      beforeKill
    })

    const closeResult = await httpJson(`/json/close/${originalWorker.id}`)
    const workerGone = await poll(
      async () => !(await listTargets()).some((target) => target.id === originalWorker.id),
      Boolean,
      "original service-worker termination"
    )
    record("isolated-sw-terminated", workerGone, {
      originalWorkerId: originalWorker.id,
      closeResult
    })

    await page.evaluate(verifyCall("reconnectTurn", turnId))
    const replacementWorkerCandidate = await poll(
      async () => findServiceWorker(await listTargets()),
      (target) => Boolean(target && target.id !== originalWorker.id),
      "replacement service worker"
    )
    if (!replacementWorkerCandidate) {
      throw new Error("Replacement service worker disappeared during recovery")
    }
    const replacementWorker = replacementWorkerCandidate
    const completed = await poll(
      () =>
        page?.evaluate<TurnResult>(
          verifyCall("durableTurnResult", turnId, assistantMessageId)
        ) ?? Promise.resolve<TurnResult>({}),
      (result) =>
        result.status === "completed" &&
        result.content === "recovered" &&
        result.done === true,
      "durable turn recovery"
    )
    const eventSummary = await page.evaluate<{
      eventTypes: string[]
      snapshots: number
      terminalChunks: number
    }>(verifyCall("turnEventSummary", turnId))
    record(
      "isolated-sw-turn-recovered-once",
      fakeOllama.calls() === 2 &&
        eventSummary.snapshots >= 1 &&
        eventSummary.terminalChunks === 1,
      {
        calls: fakeOllama.calls(),
        completed,
        eventSummary,
        originalWorkerId: originalWorker.id,
        replacementWorkerId: replacementWorker.id
      }
    )
  } finally {
    page?.close()
    await fakeOllama.close()
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

const main = async (): Promise<void> => {
  await run()
  const report = {
    measuredAt: new Date().toISOString(),
    gate: "isolated MV3 service-worker durable-turn recovery",
    topology:
      "packaged Chromium benchmark extension; service worker killed via DevTools while extension page and offscreen SQLite owner survive",
    results
  }
  mkdirSync(artifactDir, { recursive: true })
  const outputPath = resolve(
    artifactDir,
    `sw-turn-recovery-${Date.now()}.json`
  )
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  console.error(`Report written: ${outputPath}`)
  console.log(JSON.stringify(report, null, 2))
  if (results.some((result) => !result.pass)) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
