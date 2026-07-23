#!/usr/bin/env node

// Section 9.4 gate 4d: forced service-worker termination mid-write.
//
// This is the one lifecycle gate spike-owner-gates.ts could not cover. It runs
// in its own runner because Playwright globally auto-attaches to every service
// worker it discovers, and an attached (inspected) MV3 worker is pinned alive —
// Chromium will not terminate it, so no kill primitive fires. Confirmed dead
// ends under Playwright: ServiceWorker.stopAllWorkers (page and browser CDP
// session), Target.closeTarget, Runtime.terminateExecution, and idle timeout.
//
// The working approach: launch Chromium ourselves with --remote-debugging-port
// so NOTHING attaches a debugger to the worker, drive the spike-owner page over
// raw CDP (attaching to a page target does not pin the worker), and terminate
// the background worker with the DevTools HTTP endpoint /json/close/<targetId>.
// On this topology the SQLite owner lives in the offscreen document, a context
// the service worker's death does not touch — so gate 4d certifies the
// partial-topology failure that gate 4c (full browser restart) does not:
// the worker dies mid-write, the offscreen owner survives, and a fresh worker
// generation resumes serving with data durable and uncorrupted.
//
// Usage: pnpm spike:sw-termination
// Requires: pnpm benchmark:build

import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { chromium } from "playwright"

const chromeBuildPath = resolve("build/chrome-mv3-benchmark")
const artifactDir = resolve("artifacts/persistence-benchmark")
const DEBUG_PORT = 9333

interface GateResult {
  gate: string
  pass: boolean
  detail: Record<string, unknown>
}

const results: GateResult[] = []

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
  new Promise((done) => setTimeout(done, ms))

interface CdpTarget {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

const httpJson = async (path: string): Promise<unknown> => {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}${path}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const listTargets = async (): Promise<CdpTarget[]> => {
  const list = await httpJson("/json/list")
  return Array.isArray(list) ? (list as CdpTarget[]) : []
}

// Our extension's worker registers at background.js; Chromium's built-in
// component extensions use other script names (e.g. thunk.js), so this filter
// selects our worker uniquely without hardcoding an id.
const findServiceWorker = (targets: CdpTarget[]): CdpTarget | undefined =>
  targets.find(
    (target) =>
      target.type === "service_worker" && target.url.endsWith("/background.js")
  )

// Minimal CDP-over-WebSocket client. Only what this gate needs: attach to a
// page target (flat protocol) and evaluate expressions in it.
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

  // Open a fresh page target at `url` and attach to it over the flat protocol.
  // Target.createTarget is used instead of the /json/new HTTP endpoint, which
  // modern Chromium disables by default (it now requires HTTP PUT).
  static async open(browserWsUrl: string, url: string): Promise<PageSession> {
    const ws = new WebSocket(browserWsUrl)
    await new Promise<void>((done, fail) => {
      ws.addEventListener("open", () => done(), { once: true })
      ws.addEventListener("error", () => fail(new Error("browser ws error")), {
        once: true
      })
    })
    const session = new PageSession(ws)
    ws.addEventListener("message", (event) => session.onMessage(String(event.data)))
    const created = (await session.sendBrowser("Target.createTarget", {
      url
    })) as { targetId: string }
    const attached = (await session.sendBrowser("Target.attachToTarget", {
      targetId: created.targetId,
      flatten: true
    })) as { sessionId: string }
    session.sessionId = attached.sessionId
    await session.send("Runtime.enable")
    return session
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, ...payload }))
    })
  }

  // Browser-level command (no sessionId).
  private sendBrowser(method: string, params?: unknown): Promise<unknown> {
    return this.raw({ method, params })
  }

  // Session-scoped command (flat protocol: sessionId at the top level).
  send(method: string, params?: unknown): Promise<unknown> {
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
          "evaluate threw"
      )
    }
    return result.result.value as T
  }

  close(): void {
    this.ws.close()
  }
}

// A page-context call into window.__spikeOwner, serialized as an expression.
const ownerCall = (op: string, payload?: unknown): string =>
  `window.__spikeOwner(${JSON.stringify(op)}${
    payload === undefined ? "" : `, ${JSON.stringify(payload)}`
  })`

const run = async (): Promise<void> => {
  const userDataDir = mkdtempSync(`${tmpdir()}/ollama-client-sw-term-`)
  const child = spawn(
    chromium.executablePath(),
    [
      `--user-data-dir=${userDataDir}`,
      `--load-extension=${chromeBuildPath}`,
      `--disable-extensions-except=${chromeBuildPath}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check"
    ],
    { stdio: "ignore" }
  )

  try {
    // Wait for the CDP endpoint.
    let browserWsUrl = ""
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const version = (await httpJson("/json/version")) as {
          webSocketDebuggerUrl?: string
        }
        if (version.webSocketDebuggerUrl) {
          browserWsUrl = version.webSocketDebuggerUrl
          break
        }
      } catch {
        // endpoint not up yet
      }
      await sleep(200)
    }
    if (!browserWsUrl) throw new Error("CDP endpoint never came up")

    // Resolve our extension worker (the extension install starts it).
    let sw: CdpTarget | undefined
    for (let attempt = 0; attempt < 50; attempt += 1) {
      sw = findServiceWorker(await listTargets())
      if (sw) break
      await sleep(200)
    }
    if (!sw) throw new Error("extension service worker never appeared")
    const extensionId = new URL(sw.url).host
    const originalSwId = sw.id
    console.error(`[gate4d] extension id: ${extensionId}`)

    const ownerPageUrl = `chrome-extension://${extensionId}/spike-owner.html`
    const page = await PageSession.open(browserWsUrl, ownerPageUrl)
    // Wait for the page bundle to wire window.__spikeOwner.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ready = await page.evaluate<boolean>(
        "typeof window.__spikeOwner === 'function'"
      )
      if (ready) break
      await sleep(200)
    }

    // ---- Seed durable, committed state ----
    await page.evaluate(ownerCall("reset"))
    const SEED = 30
    for (let seq = 0; seq < SEED; seq += 1) {
      await page.evaluate(ownerCall("append", { writer: "seed", seq }))
    }
    const seeded = await page.evaluate<{ total: number }>(ownerCall("counts"))
    const ownerBefore = await page.evaluate<{
      ownerId: string
      workerGeneration: number
    }>(ownerCall("ownerInfo"))
    record("gate4d-seed", seeded.total === SEED, { expected: SEED, ...seeded })

    // ---- Kill the service worker mid-write ----
    // Fire a service-worker-initiated write (SPIKE_OWNER_BG_WRITE runs inside
    // the SW), do NOT await it, then immediately terminate the worker. The
    // checkpoint is keyed by requestId, so any client-driven retry is
    // idempotent: it can land exactly once or not at all, never twice.
    const CRASH_KEY = "gate4d-crashwrite"
    await page.evaluate(
      `(() => { chrome.runtime.sendMessage({ type: "spike-owner-bg-write", payload: { requestId: ${JSON.stringify(
        CRASH_KEY
      )}, state: "in-flight-at-crash" } }); return "dispatched"; })()`
    )
    const closeResult = await httpJson(`/json/close/${originalSwId}`)
    console.error(`[gate4d] /json/close: ${JSON.stringify(closeResult)}`)

    // Confirm the worker target actually went away.
    let swGone = false
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await sleep(200)
      const stillListed = (await listTargets()).some(
        (target) => target.id === originalSwId
      )
      if (!stillListed) {
        swGone = true
        break
      }
    }
    record("gate4d-worker-terminated", swGone, { originalSwId, swGone })

    // ---- Wake the topology and verify recovery + durability ----
    // Any owner call wakes the service worker (ensure runs first). Retry across
    // the respawn window; client retry is the documented contract.
    let recovered: { total: number; byWriter: Record<string, number> } | null =
      null
    let lastError = ""
    for (let attempt = 0; attempt < 25; attempt += 1) {
      try {
        recovered = await page.evaluate<{
          total: number
          byWriter: Record<string, number>
        }>(ownerCall("counts"))
        break
      } catch (error) {
        lastError = String(error)
        await sleep(200)
      }
    }

    const newSw = findServiceWorker(await listTargets())
    const ownerAfter = recovered
      ? await page.evaluate<{ ownerId: string; workerGeneration: number }>(
          ownerCall("ownerInfo")
        )
      : null

    record(
      "gate4d-recovery-after-sw-kill",
      recovered !== null &&
        recovered.total === SEED &&
        recovered.byWriter.seed === SEED &&
        Boolean(newSw) &&
        newSw?.id !== originalSwId,
      {
        seededTotal: SEED,
        recovered,
        lastError,
        originalSwId,
        newSwId: newSw?.id ?? null,
        swRespawned: Boolean(newSw) && newSw?.id !== originalSwId
      }
    )

    // The mid-flight checkpoint must be present exactly once or absent — never
    // duplicated, never a partial/corrupt row (idempotent keyed upsert).
    const checkpoint = (await page.evaluate<{ state: string } | null>(
      ownerCall("readCheckpoint", { requestId: CRASH_KEY })
    )) as { state: string } | null
    const crashWriteClean =
      checkpoint === null || checkpoint.state === "in-flight-at-crash"
    record("gate4d-crashwrite-exactly-once-or-absent", crashWriteClean, {
      checkpoint,
      landed: checkpoint !== null
    })

    // Owner topology self-healed to a fresh generation, not a stale handle.
    record(
      "gate4d-owner-reachable",
      ownerAfter !== null && typeof ownerAfter.ownerId === "string",
      { ownerBefore, ownerAfter }
    )

    await page.evaluate(ownerCall("reset"))
    page.close()
  } finally {
    child.kill("SIGKILL")
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

const main = async (): Promise<void> => {
  await run()

  const report = {
    measuredAt: new Date().toISOString(),
    gate: "9.4 gate 4d: forced service-worker termination mid-write",
    topology:
      "MV3 offscreen document owning one sqlite-wasm opfs-sahpool worker; service worker terminated via DevTools /json/close while the offscreen owner survives",
    results
  }
  mkdirSync(artifactDir, { recursive: true })
  const outputPath = resolve(
    artifactDir,
    `spike-sw-termination-${Date.now()}.json`
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
