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
  const { resolveAgentFollowUp } =
    await import("@/background/agent/agent-follow-up")
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
    "fits rebuildable continuity around the immutable task in UTF-8 bytes",
    async () => {
      const { runs } = await boot()
      const goal = "任".repeat(20_000)
      await runs.createAgentRun({
        ...runState("large-checkpoint"),
        goal,
        evidenceLedger: Array.from({ length: 16 }, (_, index) => ({
          id: `fact-${index}`,
          kind: "observed_fact" as const,
          validity: "historical" as const,
          observedAt: CREATED_AT,
          quote: `${index} ${"事".repeat(190)}`,
          source: {
            tabId: 1,
            frameId: 0,
            documentId: "doc-1",
            snapshotId: "snapshot-1",
            generation: 1,
            origin: "https://example.com"
          }
        })),
        stall: { noProgress: 2, refusedCommands: 1 }
      })
      const stored = (await runs.getAgentRun("large-checkpoint"))?.state
      expect(stored?.goal).toBe(goal)
      expect(stored?.stall).toMatchObject({ noProgress: 2, refusedCommands: 1 })
      expect(stored?.evidenceLedger).toBeUndefined()
      expect(
        new TextEncoder().encode(JSON.stringify({ version: 1, state: stored }))
          .length
      ).toBeLessThanOrEqual(runs.MAX_AGENT_CHECKPOINT_BYTES)
    },
    TIMEOUT
  )

  it(
    "reads an append-only receipt tail without losing concurrent appends or earlier steps",
    async () => {
      const { runs } = await boot()
      await runs.createAgentRun(runState("tail-1"))
      const hostCall = globalThis.__persistenceHostCall!
      const tailReads: number[] = []
      globalThis.__persistenceHostCall = async (request) => {
        if (
          request.op === "query" &&
          request.sql.includes("FROM agent_steps WHERE runId = ? AND id > ?")
        )
          tailReads.push(Number(request.bind?.[1]))
        return hostCall(request)
      }
      const read = runs.createAgentStepReader(true)
      await runs.appendAgentStep({
        runId: "tail-1",
        stepId: "step-1",
        status: "planned",
        at: CREATED_AT
      })
      const first = await read("tail-1")
      expect(first).toHaveLength(1)
      await runs.appendAgentStep({
        runId: "tail-1",
        stepId: "step-1",
        status: "verified",
        at: CREATED_AT + 1
      })
      const [second, third] = await Promise.all([
        read("tail-1"),
        read("tail-1")
      ])
      expect(second.map((step) => step.status)).toEqual(["planned", "verified"])
      expect(third).toEqual(second)
      expect(first).toHaveLength(1)
      expect(tailReads).toEqual([0, first[0].sequence, second[1].sequence])
      const { runs: reloaded } = await boot()
      expect(await reloaded.createAgentStepReader(true)("tail-1")).toEqual(
        second
      )
    },
    TIMEOUT
  )

  it(
    "hashes private stall URLs in the durable checkpoint",
    async () => {
      const { runs } = await boot()
      await runs.createAgentRun({
        ...runState("private-url"),
        stall: {
          recent: [
            {
              url: "https://example.com/private?token=secret#private",
              snapshotHash: "abc",
              fingerprint: "def"
            }
          ]
        }
      })
      const state = (await runs.getAgentRun("private-url"))?.state
      expect(state?.stall?.recent?.[0].url).toMatch(/^url:[a-f0-9]+$/)
      expect(JSON.stringify(state)).not.toContain("secret")
    },
    TIMEOUT
  )

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

  it(
    "keeps the ids a review found contradicted on its receipt across a reload",
    async () => {
      const { runs } = await boot()
      await runs.createAgentRun(runState("review-1"))
      await runs.appendAgentStep({
        runId: "review-1",
        stepId: "review-1:completion:1",
        status: "rejected",
        at: CREATED_AT + 1,
        telemetry: { reviews: 1 },
        reviewContradicted: ["r1", "c1"]
      })
      const { runs: reloaded } = await boot()
      const steps = await reloaded.listAgentSteps("review-1")
      expect(steps.at(-1)).toMatchObject({
        reviewContradicted: ["r1", "c1"],
        telemetry: { reviews: 1 }
      })
    },
    TIMEOUT
  )
})
