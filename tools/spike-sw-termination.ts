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
// generation resumes serving.
//
// Two writes bracket the kill so both properties are proven: a committed write
// (awaited) that MUST survive — durability — and a burst of unawaited writes
// still crossing the SW -> offscreen boundary when it dies — atomicity, each
// all-or-nothing, never partial/duplicated. Owner continuity (same ownerId and
// workerGeneration across the kill) proves the offscreen owner was not replaced.
//
// Usage: pnpm spike:sw-termination
// Requires: pnpm benchmark:build

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

const chromeBuildPath = resolve("build/chrome-mv3-benchmark")
const artifactDir = resolve("artifacts/persistence-benchmark")

// Chromium picks a free port when launched with --remote-debugging-port=0 and
// writes it to DevToolsActivePort in the profile dir. Resolving it per run
// keeps concurrent runners (and a busy 9333) from colliding on a shared port.
let debugPort = 0

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
  const res = await fetch(`http://127.0.0.1:${debugPort}${path}`)
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
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check"
    ],
    { stdio: "ignore" }
  )

  try {
    // Chromium writes the port it actually chose to DevToolsActivePort once the
    // endpoint is listening.
    const activePortFile = resolve(userDataDir, "DevToolsActivePort")
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const firstLine = readFileSync(activePortFile, "utf8").split("\n")[0]
        const parsed = Number.parseInt(firstLine, 10)
        if (Number.isInteger(parsed) && parsed > 0) {
          debugPort = parsed
          break
        }
      } catch {
        // not written yet
      }
      await sleep(100)
    }
    if (!debugPort) throw new Error("Chromium never reported its debugging port")

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
    // The offscreen owner initializes its SQLite worker asynchronously (fetch
    // the wasm, acquire the opfs-sahpool lock); the very first RPC can race that
    // init. Warm up with a few retries so a one-off startup stall does not flake
    // the gate before it has tested anything.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await page.evaluate(ownerCall("ownerInfo"))
        break
      } catch (error) {
        if (attempt >= 3) throw error
        await sleep(500)
      }
    }
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

    // ---- Two service-worker writes, then terminate the worker ----
    // SPIKE_OWNER_BG_WRITE runs inside the SW: it ensures the owner and forwards
    // the keyed upsert to the offscreen worker.
    //
    // (a) Durability. A committed write that MUST survive. We AWAIT its ack, so
    // the checkpoint is on disk in the offscreen owner before termination; the
    // gate then requires it present with its exact state afterward. Absence is a
    // failure — that is the durability guarantee the gate exists to prove.
    const DURABLE_KEY = "gate4d-durable"
    const DURABLE_STATE = "committed-before-sw-kill"
    const durableAck = await page.evaluate<{ ok?: boolean } | undefined>(
      `(async () => await chrome.runtime.sendMessage({ type: "spike-owner-bg-write", payload: { requestId: ${JSON.stringify(
        DURABLE_KEY
      )}, state: ${JSON.stringify(DURABLE_STATE)} } }))()`
    )
    record("gate4d-sw-write-committed", Boolean(durableAck?.ok), { durableAck })

    // (b) Atomicity across the genuine mid-write window. A burst of keyed SW
    // writes dispatched WITHOUT awaiting, so they are still crossing the service
    // worker -> offscreen boundary (or mid-exec) when the worker is torn down a
    // moment later. Whether each one lands is timing-dependent — that IS the
    // crash window this gate is meant to exercise — but the invariant is not:
    // every key must be present with its exact state or wholly absent, never a
    // partial, wrong, or duplicated row (the requestId is the upsert key).
    const INFLIGHT_STATE = "in-flight-at-kill"
    // A large burst so the worker is torn down with writes still queued and
    // undelivered — a small burst drains before /json/close lands and never
    // exercises the crash window. The gate asserts atomicity (below), and
    // expects the interruption to be real: some of these must NOT survive.
    const INFLIGHT_KEYS = Array.from(
      { length: 400 },
      (_, index) => `gate4d-inflight-${index}`
    )
    await page.evaluate(
      `(() => { for (const key of ${JSON.stringify(
        INFLIGHT_KEYS
      )}) { chrome.runtime.sendMessage({ type: "spike-owner-bg-write", payload: { requestId: key, state: ${JSON.stringify(
        INFLIGHT_STATE
      )} } }); } return "dispatched"; })()`
    )
    // Terminate immediately, while the burst is in flight.
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

    const swRespawned = Boolean(newSw) && newSw?.id !== originalSwId
    record(
      "gate4d-recovery-after-sw-kill",
      recovered !== null &&
        recovered.total === SEED &&
        recovered.byWriter.seed === SEED &&
        swRespawned,
      {
        seededTotal: SEED,
        recovered,
        lastError,
        originalSwId,
        newSwId: newSw?.id ?? null,
        swRespawned
      }
    )

    // One aggregate read of the whole checkpoint table — a single RPC, so the
    // readback cannot itself drop a response the way hundreds of per-key reads
    // could. Every checkpoint row was written by the service worker; the
    // requestId primary key means at most one row per key (no duplicates by
    // construction), and each write set exactly one of the two known states.
    const summary = await page.evaluate<{
      total: number
      byState: Record<string, number>
    }>(ownerCall("checkpointSummary"))

    // (a) Durability: the committed write MUST have survived — exactly one row
    // in its own state (absence = lost write = fail).
    record("gate4d-crashwrite-durable", summary.byState[DURABLE_STATE] === 1, {
      summary,
      expectedState: DURABLE_STATE
    })

    // (b) Atomicity across the genuine crash window. Any state other than the
    // two the writers set is a partial/corrupt row and fails. The interruption
    // must also be real: fewer than all in-flight writes survived — if the full
    // burst drained before the kill landed, the window was never exercised and
    // the gate fails rather than certify vacuously.
    const landed = summary.byState[INFLIGHT_STATE] ?? 0
    const unexpectedStates = Object.keys(summary.byState).filter(
      (state) => state !== DURABLE_STATE && state !== INFLIGHT_STATE
    )
    record(
      "gate4d-inflight-write-atomic",
      unexpectedStates.length === 0 && landed < INFLIGHT_KEYS.length,
      {
        landed,
        total: INFLIGHT_KEYS.length,
        dropped: INFLIGHT_KEYS.length - landed,
        unexpectedStates,
        checkpointRows: summary.total
      }
    )

    // The core claim: the OFFSCREEN owner survived the SW's death rather than
    // being torn down and replaced. Same ownerId AND same workerGeneration
    // across the kill proves continuity — a replacement would change ownerId,
    // and a worker restart would bump the generation.
    record(
      "gate4d-owner-continuity",
      ownerAfter !== null &&
        ownerAfter.ownerId === ownerBefore.ownerId &&
        ownerAfter.workerGeneration === ownerBefore.workerGeneration,
      { ownerBefore, ownerAfter }
    )

    await page.evaluate(ownerCall("reset"))
    page.close()
  } finally {
    child.kill("SIGKILL")
    // The killed browser releases the profile dir asynchronously; retry the
    // removal instead of letting an ENOTEMPTY race fail an otherwise-green run.
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
