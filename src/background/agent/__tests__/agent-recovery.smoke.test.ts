import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import type { AgentRunState } from "@ollama-client/contracts"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest"

import { SQLITE_DB_KEY, SQLITE_DB_NAME, SQLITE_DB_STORE } from "@/lib/constants"
import { createChatDbEngine } from "@/lib/persistence/chat-db-engine"

/**
 * Startup recovery, driven through the real engine at every phase a worker can
 * die in.
 *
 * Recovery was asserted against a mocked repository, which proves the function
 * calls the helpers it means to and nothing about whether the SQL underneath
 * moves the run. Every transition here is a compare-and-set against the
 * status the row actually holds, so a predecessor list that disagrees with the
 * recovery path typechecks and fails only in a browser, on a run the user
 * cared about.
 *
 * The other half of the promise — that a real terminated worker reaches this
 * state at all — needs the browser and is a separate runner; see
 * `tools/verify/verify-sw-turn-recovery.ts` for the shape it has to take,
 * because Playwright pins extension service workers alive and cannot kill one.
 */

const TIMEOUT = 25_000

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")
let wasmBuffer: ArrayBuffer

beforeAll(() => {
  const wasm = readFileSync(wasmPath)
  wasmBuffer = wasm.buffer.slice(
    wasm.byteOffset,
    wasm.byteOffset + wasm.byteLength
  )
})

const installOwner = () => {
  const engine = createChatDbEngine({ wasmBinary: Promise.resolve(wasmBuffer) })
  const ready = engine.submit({ op: "setBackend", backend: "legacy" })
  globalThis.__persistenceHostCall = async (request) => {
    await ready
    return engine.submit(request)
  }
}

const clearSqliteStore = (): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SQLITE_DB_STORE)) {
        db.createObjectStore(SQLITE_DB_STORE)
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SQLITE_DB_STORE)) {
        db.close()
        resolve()
        return
      }
      const tx = db.transaction([SQLITE_DB_STORE], "readwrite")
      tx.objectStore(SQLITE_DB_STORE).delete(SQLITE_DB_KEY)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
  })

beforeEach(async () => {
  await clearSqliteStore()
}, TIMEOUT)

afterEach(() => {
  globalThis.__persistenceHostCall = undefined
})

const runState = (
  status: AgentRunState["status"],
  overrides: Partial<AgentRunState> = {}
): AgentRunState => ({
  version: 1,
  id: "run-recovery",
  goal: "Inspect the page",
  status,
  stepCount: 1,
  observationCount: 1,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "model",
  allowedOrigins: ["https://example.com"],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides
})

const command = {
  type: "click",
  ref: "e1",
  snapshotId: "snapshot-1",
  generation: 1
} as const

const boot = async () => {
  vi.resetModules()
  installOwner()
  return import("@/lib/repositories/agent-runs")
}

type Repo = Awaited<ReturnType<typeof boot>>

/**
 * The legal route from `submitted` to each phase. A run may only be created
 * in `submitted`, so the fixture claims its way there rather than writing the
 * status directly — which also means every hop is the same compare-and-set
 * the controller uses, and a route the state machine forbids cannot be tested
 * into existence.
 */
const ROUTES: Record<string, readonly AgentRunState["status"][]> = {
  observing: ["observing"],
  deciding: ["observing", "deciding"],
  awaiting_approval: ["observing", "deciding", "awaiting_approval"],
  awaiting_takeover: ["observing", "deciding", "awaiting_takeover"],
  executing: ["observing", "deciding", "awaiting_approval", "executing"],
  verifying: [
    "observing",
    "deciding",
    "awaiting_approval",
    "executing",
    "verifying"
  ],
  pause_requested: ["observing", "pause_requested"],
  cancelling: ["observing", "cancelling"]
}

const walkTo = async (
  repo: Repo,
  runId: string,
  status: AgentRunState["status"],
  onPhase?: (phase: AgentRunState["status"]) => Promise<void>
): Promise<void> => {
  let from: AgentRunState["status"] = "submitted"
  for (const phase of ROUTES[status] ?? []) {
    const claimed = await repo.claimAgentRunPhase({
      runId,
      phase,
      expected: [from],
      patch: { updatedAt: 1_700_000_000_000 }
    })
    if (!claimed.claimed) {
      throw new Error(`Could not claim ${phase} from ${from}`)
    }
    from = phase
    await onPhase?.(phase)
  }
}

/** A run interrupted mid-phase, with the receipts that phase would have left. */
const seed = async (
  status: AgentRunState["status"],
  steps: ("planned" | "approved" | "executing" | "executed")[],
  runId = "run-recovery"
) => {
  const repo = await boot()
  await repo.createAgentRun(runState("submitted", { id: runId }))
  let appended = false
  const append = async () => {
    if (appended) return
    appended = true
    for (const [index, stepStatus] of steps.entries()) {
      await repo.appendAgentStep({
        runId,
        stepId: `${runId}:1`,
        status: stepStatus,
        command,
        at: 1_700_000_000_000 + index,
        ...(stepStatus === "planned"
          ? { target: { ref: "e1", tag: "button", name: "Continue" } }
          : {})
      })
    }
  }
  /**
   * Written from `deciding`, where the controller writes them: claiming
   * `executing` refuses a run with no durable planned step, so a fixture that
   * appended afterwards could not reach the phase it means to test.
   */
  await walkTo(repo, runId, status, async (phase) => {
    if (phase === "deciding") await append()
  })
  await append()
  const recovery = await import("../agent-recovery")
  return { repo, recovery }
}

describe("agent startup recovery against the real engine", () => {
  it(
    "settles a cancellation without reissuing anything",
    async () => {
      const { repo, recovery } = await seed("cancelling", [
        "planned",
        "approved",
        "executing"
      ])
      await recovery.recoverAgentRuns()

      const run = await repo.getAgentRun("run-recovery")
      expect(run?.state?.status).toBe("cancelled")
      // A user's stop is not a failure and not an uncertainty.
      expect(
        (await repo.listAgentSteps("run-recovery")).map((step) => step.status)
      ).toEqual(["planned", "approved", "executing"])
    },
    TIMEOUT
  )

  it.each([
    ["executing", ["planned", "approved", "executing"]],
    ["verifying", ["planned", "approved", "executing", "executed"]]
  ] as const)(
    "marks an effect interrupted in %s as uncertain and pauses",
    async (status, steps) => {
      const { repo, recovery } = await seed(status, [...steps])
      await recovery.recoverAgentRuns()

      const run = await repo.getAgentRun("run-recovery")
      expect(run?.state).toMatchObject({
        status: "paused",
        pauseReason: "unresolved_effect"
      })
      // The effect may already have happened, so it is recorded as unknown
      // rather than repeated — one click must not become two.
      const recovered = await repo.listAgentSteps("run-recovery")
      expect(recovered.at(-1)).toMatchObject({
        status: "uncertain",
        stepId: "run-recovery:1"
      })
      expect(
        recovered.filter((step) => step.status === "uncertain")
      ).toHaveLength(1)
    },
    TIMEOUT
  )

  it.each([
    ["awaiting_approval", "panel_closed"],
    ["awaiting_takeover", "takeover"],
    ["observing", "panel_closed"],
    ["deciding", "panel_closed"],
    ["pause_requested", "panel_closed"]
  ] as const)(
    "pauses a run interrupted in %s with reason %s",
    async (status, reason) => {
      const { repo, recovery } = await seed(status, ["planned"])
      await recovery.recoverAgentRuns()

      const run = await repo.getAgentRun("run-recovery")
      expect(run?.state).toMatchObject({
        status: "paused",
        pauseReason: reason
      })
      // Recovery never observes, decides or executes; a read-only phase
      // leaves its receipts exactly as it found them.
      expect(
        (await repo.listAgentSteps("run-recovery")).map((step) => step.status)
      ).toEqual(["planned"])
    },
    TIMEOUT
  )

  it(
    "leaves a settled run alone, so its record survives the restart",
    async () => {
      const { repo } = await seed("deciding", ["planned"])
      const settled = await repo.transitionAgentRun({
        runId: "run-recovery",
        from: "deciding",
        to: "completed",
        patch: { result: "Done", updatedAt: 1_700_000_000_000 }
      })
      expect(settled.transitioned).toBe(true)
      const recovery = await import("../agent-recovery")
      await recovery.recoverAgentRuns()

      const run = await repo.getAgentRun("run-recovery")
      expect(run?.state).toMatchObject({ status: "completed", result: "Done" })
    },
    TIMEOUT
  )

  it(
    "recovers every interrupted run, not only the first",
    async () => {
      const { repo } = await seed("deciding", ["planned"], "run-a")
      await repo.createAgentRun(runState("submitted", { id: "run-b" }))
      await walkTo(repo, "run-b", "awaiting_takeover")
      await repo.createAgentRun(runState("submitted", { id: "run-c" }))
      await walkTo(repo, "run-c", "cancelling")
      const recovery = await import("../agent-recovery")
      await recovery.recoverAgentRuns()

      expect([
        (await repo.getAgentRun("run-a"))?.state?.status,
        (await repo.getAgentRun("run-b"))?.state?.status,
        (await repo.getAgentRun("run-c"))?.state?.status
      ]).toEqual(["paused", "paused", "cancelled"])
    },
    TIMEOUT
  )

  it(
    "is safe to run twice, because a restart can be interrupted too",
    async () => {
      const { repo, recovery } = await seed("executing", [
        "planned",
        "approved",
        "executing"
      ])
      await recovery.recoverAgentRuns()
      await recovery.recoverAgentRuns()

      const recovered = await repo.listAgentSteps("run-recovery")
      expect(
        recovered.filter((step) => step.status === "uncertain")
      ).toHaveLength(1)
      expect((await repo.getAgentRun("run-recovery"))?.state).toMatchObject({
        status: "paused",
        pauseReason: "unresolved_effect"
      })
    },
    TIMEOUT
  )
})
