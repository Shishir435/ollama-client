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
 * A run's task contract — requirement ids, constraints, the plan's version
 * and its amendments — through the real engine and back, and into the
 * follow-up that reads it. A field the checkpoint schema forgot is a field a
 * worker restart silently drops, which no mock would show.
 */

const TIMEOUT = 25_000
const CREATED_AT = 1_700_000_000_000

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

const runState = (id: string): AgentRunState => ({
  version: 1,
  id,
  goal: "Fill in Alice's details without submitting, then report the total",
  status: "submitted",
  stepCount: 0,
  observationCount: 0,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "qwen3",
  allowedOrigins: ["https://example.com"],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT
})

const boot = async () => {
  vi.resetModules()
  installOwner()
  await import("@/lib/repositories/chat-history")
  const runs = await import("@/lib/repositories/agent-runs")
  const { resolveAgentFollowUp } = await import(
    "@/background/agent/agent-follow-up"
  )
  return { runs, resolveAgentFollowUp }
}

const plan = {
  requirements: [
    {
      id: "r1",
      text: "the form holds Alice's details",
      kind: "change" as const,
      source: "Fill in Alice's details",
      items: ["name", "email"]
    },
    { id: "r3", text: "the total is reported", kind: "read" as const }
  ],
  constraints: [
    {
      id: "c1",
      text: "without submitting",
      kind: "exclude" as const,
      forbids: ["submission" as const],
      source: "without submitting"
    }
  ],
  plan: {
    version: 2,
    issued: { requirements: 3, constraints: 1 },
    reconciledThrough: CREATED_AT + 5,
    amendments: [
      {
        version: 2,
        answeredAt: CREATED_AT + 5,
        added: ["r3"],
        removed: ["r2"],
        at: CREATED_AT + 6
      }
    ]
  }
}

describe("a run's task contract in the durable record", () => {
  it(
    "keeps requirement ids, constraints and the plan version across a reload",
    async () => {
      const { runs } = await boot()
      await runs.createAgentRun(runState("plan-1"))
      await runs.transitionAgentRun({
        runId: "plan-1",
        from: "submitted",
        to: "planning"
      })
      await runs.transitionAgentRun({
        runId: "plan-1",
        from: "planning",
        to: "observing",
        patch: { ...plan, updatedAt: CREATED_AT + 7 }
      })

      const { runs: reloaded } = await boot()
      const run = await reloaded.getAgentRun("plan-1")
      expect(run?.state).toMatchObject({
        status: "observing",
        goal: "Fill in Alice's details without submitting, then report the total",
        ...plan
      })
    },
    TIMEOUT
  )

  it(
    "keeps workflow and evidence across a paused worker reload, then drops the redundant terminal progress",
    async () => {
      const { runs } = await boot()
      const workflow = {
        version: 1 as const,
        planVersion: 2,
        throughSequence: 1,
        entries: [
          {
            requirementId: "r1",
            itemIndex: 0,
            status: "verified" as const,
            evidenceIds: [],
            effect: { sequence: 1, settlement: "confirmed" as const }
          },
          {
            requirementId: "r1",
            itemIndex: 1,
            status: "pending" as const,
            evidenceIds: []
          }
        ],
        phase: { index: 1, total: 2, kind: "act" as const }
      }
      await runs.createAgentRun(runState("workflow-1"))
      await runs.transitionAgentRun({
        runId: "workflow-1",
        from: "submitted",
        to: "planning"
      })
      await runs.transitionAgentRun({
        runId: "workflow-1",
        from: "planning",
        to: "observing",
        patch: { ...plan, workflow, evidenceLedger: [], stepCount: 9 }
      })
      await runs.transitionAgentRun({
        runId: "workflow-1",
        from: "observing",
        to: "pause_requested"
      })
      await runs.transitionAgentRun({
        runId: "workflow-1",
        from: "pause_requested",
        to: "paused",
        patch: { pauseReason: "user" }
      })
      const { runs: reloaded } = await boot()
      const restored = (await reloaded.getAgentRun("workflow-1"))?.state
      expect(restored).toMatchObject({
        status: "paused",
        workflow,
        stepCount: 9,
        constraints: plan.constraints
      })
      await reloaded.transitionAgentRun({
        runId: "workflow-1",
        from: "paused",
        to: "cancelling"
      })
      await reloaded.transitionAgentRun({
        runId: "workflow-1",
        from: "cancelling",
        to: "cancelled"
      })
      expect(
        (await reloaded.getAgentRun("workflow-1"))?.state
      ).not.toHaveProperty("workflow")
    },
    TIMEOUT
  )

  it(
    "hands a follow-up the parent's ids with what its outcome said of each",
    async () => {
      const { runs, resolveAgentFollowUp } = await boot()
      await runs.createAgentRun(runState("plan-parent"))
      for (const [from, to] of [
        ["submitted", "planning"],
        ["planning", "observing"],
        ["observing", "deciding"],
        ["deciding", "partial"]
      ] as const) {
        await runs.transitionAgentRun({
          runId: "plan-parent",
          from,
          to,
          patch:
            to === "observing"
              ? plan
              : to === "partial"
                ? {
                    outcome: { met: ["r1"], unmet: ["r3"] },
                    result: "Filled the form; the total was not shown.",
                    updatedAt: CREATED_AT + 9
                  }
                : undefined
        })
      }

      const resolution = await resolveAgentFollowUp(
        { parentRunId: "plan-parent", mode: "retry" },
        undefined,
        { run: runs.getAgentRun, steps: runs.listAgentSteps }
      )

      expect(resolution).toMatchObject({
        ok: true,
        previousRun: {
          requirements: [
            { id: "r1", kind: "change", met: true },
            { id: "r3", kind: "read", met: false }
          ],
          /** The parent's prohibition travels; the follow-up must not submit. */
          constraints: [{ id: "c1", forbids: ["submission"] }]
        }
      })
      expect(
        resolution.ok &&
          resolution.previousRun.requirements?.some(
            (requirement) => "items" in requirement
          )
      ).toBe(false)
    },
    TIMEOUT
  )
})
