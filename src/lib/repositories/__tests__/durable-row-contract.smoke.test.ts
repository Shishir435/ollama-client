import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
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
 * Writer/reader alignment for every durable job repository (RELEASE_ROADMAP H7).
 *
 * Each of these modules writes rows with one SQL statement and decodes them with
 * a Zod schema written by hand beside it. Nothing makes the two agree — a column
 * renamed in the INSERT, a value stored as text that the schema calls a number,
 * or an enum member added to the writer and not the reader all typecheck fine
 * and fail only at runtime, where the symptom is a job that silently vanishes
 * from recovery.
 *
 * So this drives the real engine: save through the repository, read back through
 * the repository, and require the value to survive. A schema that disagrees with
 * its own writer decodes to null, and every assertion here fails.
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

/** Stand in for the database owner; see chat-durability.smoke.test.ts. */
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

const boot = async () => {
  vi.resetModules()
  installOwner()
  const facade = await import("@/lib/repositories/chat-history")
  await facade.addSession({
    id: "s-rows",
    title: "Row contract",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    messages: []
  })
  return facade
}

describe("durable job rows decode as their writers wrote them", () => {
  it(
    "round-trips agent ownership and claims execution before effect evidence",
    async () => {
      await boot()
      const repo = await import("@/lib/repositories/agent-runs")
      const createdAt = 1_700_000_000_000
      await repo.createAgentRun({
        version: 1,
        id: "agent-row-1",
        goal: "Inspect the current page",
        status: "submitted",
        stepCount: 0,
        observationCount: 0,
        controlledTabId: 7,
        providerId: "ollama",
        modelId: "model",
        allowedOrigins: ["https://example.com"],
        createdAt,
        updatedAt: createdAt
      })

      const observing = await repo.claimAgentRunPhase({
        runId: "agent-row-1",
        phase: "observing",
        expected: ["submitted"],
        patch: { updatedAt: createdAt + 1 }
      })
      expect(observing.claimed).toBe(true)

      const losingOwner = await repo.claimAgentRunPhase({
        runId: "agent-row-1",
        phase: "observing",
        expected: ["submitted"],
        patch: { updatedAt: createdAt + 2 }
      })
      expect(losingOwner.claimed).toBe(false)

      await repo.transitionAgentRun({
        runId: "agent-row-1",
        from: "observing",
        to: "deciding",
        patch: { updatedAt: createdAt + 3 }
      })
      await repo.appendAgentStep({
        runId: "agent-row-1",
        stepId: "agent-row-1:1",
        status: "planned",
        command: {
          type: "back",
          snapshotId: "snapshot-1",
          generation: 1
        },
        at: createdAt + 4
      })
      await repo.claimAgentRunPhase({
        runId: "agent-row-1",
        phase: "awaiting_approval",
        expected: ["deciding"],
        patch: { updatedAt: createdAt + 5 }
      })
      await repo.appendAgentStep({
        runId: "agent-row-1",
        stepId: "agent-row-1:1",
        status: "approved",
        risk: "low",
        at: createdAt + 6
      })
      const executing = await repo.claimAgentRunPhase({
        runId: "agent-row-1",
        phase: "executing",
        expected: ["awaiting_approval"],
        patch: { stepCount: 1, updatedAt: createdAt + 7 }
      })

      expect(executing.claimed).toBe(true)
      await expect(repo.listAgentSteps("agent-row-1")).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "executing" })
        ])
      )
    },
    TIMEOUT
  )

  it(
    "compacts an agent checkpoint in the terminal CAS statement",
    async () => {
      await boot()
      const repo = await import("@/lib/repositories/agent-runs")
      const db = await import("@/lib/sqlite/db")
      await repo.createAgentRun({
        version: 1,
        id: "agent-terminal-1",
        goal: "Finish safely",
        status: "submitted",
        stepCount: 0,
        observationCount: 1,
        controlledTabId: 7,
        providerId: "ollama",
        modelId: "model",
        allowedOrigins: ["https://example.com"],
        createdAt: 1,
        updatedAt: 2
      })

      await repo.claimAgentRunPhase({
        runId: "agent-terminal-1",
        phase: "observing",
        expected: ["submitted"],
        patch: { updatedAt: 2 }
      })
      await repo.transitionAgentRun({
        runId: "agent-terminal-1",
        from: "observing",
        to: "deciding",
        patch: { updatedAt: 2 }
      })
      await repo.transitionAgentRun({
        runId: "agent-terminal-1",
        from: "deciding",
        to: "completed",
        patch: { updatedAt: 3 }
      })

      const rows = await db.query(
        "SELECT status, checkpoint FROM agent_runs WHERE id = ?",
        ["agent-terminal-1"]
      )
      expect(rows[0]?.status).toBe("completed")
      expect(JSON.parse(String(rows[0]?.checkpoint))).toEqual({
        version: 1,
        compacted: true,
        terminalAt: 3
      })
      await expect(repo.getAgentRun("agent-terminal-1")).resolves.toMatchObject(
        { status: "completed", compacted: true, state: undefined }
      )
    },
    TIMEOUT
  )

  it(
    "rejects oversized agent evidence before writing it",
    async () => {
      await boot()
      const repo = await import("@/lib/repositories/agent-runs")
      await expect(
        repo.appendAgentStep({
          runId: "missing-agent",
          stepId: "missing-agent:1",
          status: "planned",
          command: {
            type: "type",
            ref: "field-1",
            snapshotId: "snapshot-1",
            generation: 1,
            text: "x".repeat(20_000)
          },
          at: 1
        })
      ).rejects.toThrow(/byte limit/)
    },
    TIMEOUT
  )

  it(
    "round-trips an ingestion run through both of its readers",
    async () => {
      await boot()
      const repo = await import("@/lib/repositories/ingestion-runs")
      const value = {
        id: "ing-1",
        fileId: "file-1",
        knowledgeSetId: "set-1",
        fileName: "notes.txt",
        status: "running" as const,
        phase: "embedding" as const,
        autoEmbed: true,
        failure: undefined,
        createdAt: 10,
        updatedAt: 11
      }

      await repo.saveIngestionRun(value)

      await expect(repo.getIngestionRun("ing-1")).resolves.toEqual(value)
      // `autoEmbed` is stored as an integer; a schema calling it a boolean would
      // drop the row here rather than at the point some resume path needs it.
      await expect(repo.listIncompleteIngestionRuns()).resolves.toEqual([value])
    },
    TIMEOUT
  )

  it(
    "round-trips a model pull run, including its structured failure",
    async () => {
      await boot()
      const repo = await import("@/lib/repositories/model-pull-runs")
      const value = {
        id: "pull-1",
        model: "llama3",
        providerId: "ollama",
        status: "running" as const,
        statusText: "downloading",
        progress: 0.5,
        failure: undefined,
        createdAt: 20,
        updatedAt: 21
      }

      await repo.saveModelPullRun(value)

      await expect(repo.getModelPullRun("pull-1")).resolves.toEqual(value)
      await expect(repo.listActiveModelPullRuns()).resolves.toEqual([value])
      await expect(
        repo.findActiveModelPullRun("llama3", "ollama")
      ).resolves.toEqual(value)

      const failed = {
        ...value,
        status: "failed" as const,
        failure: {
          status: 500,
          message: "Provider unavailable",
          kind: "provider" as const
        }
      }
      await repo.saveModelPullRun(failed)
      await expect(repo.getModelPullRun("pull-1")).resolves.toEqual(failed)
    },
    TIMEOUT
  )

  it(
    "round-trips a tool-loop checkpoint at an approval boundary",
    async () => {
      await boot()
      const repo = await import("@/lib/repositories/tool-loop-runs")
      const value = {
        requestId: "req-1",
        sessionId: "s-rows",
        model: "llama3",
        providerId: "ollama",
        mode: "native" as const,
        status: "awaiting-confirmation" as const,
        state: {
          iteration: 2,
          phase: "tools",
          workingMessages: [{ role: "user", content: "hi" }],
          toolRuns: []
        },
        updatedAt: 30
      }

      await repo.saveToolLoopRun(value as never)

      const restored = await repo.getToolLoopRun("req-1")
      expect(restored).toMatchObject({
        requestId: "req-1",
        mode: "native",
        status: "awaiting-confirmation",
        updatedAt: 30
      })
      expect(restored?.state).toMatchObject({ iteration: 2 })
    },
    TIMEOUT
  )

  it(
    "restores checkpoint attachment bytes as a real typed array",
    async () => {
      await boot()
      const repo = await import("@/lib/repositories/tool-loop-runs")
      const attachment = {
        fileId: "f-1",
        fileName: "notes.txt",
        fileType: "text/plain",
        fileSize: 3,
        processedAt: 1,
        data: Uint8Array.from([7, 8, 9])
      }

      await repo.saveToolLoopRun({
        requestId: "req-bytes",
        sessionId: "s-rows",
        model: "llama3",
        mode: "native",
        status: "running",
        state: {
          iteration: 1,
          phase: "model",
          workingMessages: [
            { role: "user", content: "see attached", attachments: [attachment] }
          ],
          toolRuns: []
        },
        updatedAt: 50
      } as never)

      const restored = await repo.getToolLoopRun("req-bytes")
      const data = restored?.state.workingMessages[0]?.attachments?.[0]?.data

      // A checkpoint is stored with JSON.stringify, which turns a Uint8Array
      // into `{"0":7,"1":8,"2":9}`. The old cast asserted it was still a typed
      // array, so a resumed loop handed a plain object to everything reading
      // `.byteLength` or building a Blob from it.
      expect(data).toBeInstanceOf(Uint8Array)
      expect(Array.from(data as Uint8Array)).toEqual([7, 8, 9])
    },
    TIMEOUT
  )

  it(
    "reports a checkpoint whose stored shape is wrong instead of losing it",
    async () => {
      await boot()
      const repo = await import("@/lib/repositories/tool-loop-runs")
      const db = await import("@/lib/sqlite/db")
      await repo.saveToolLoopRun({
        requestId: "req-bad",
        sessionId: "s-rows",
        model: "llama3",
        mode: "native",
        status: "running",
        state: {
          iteration: 1,
          phase: "model",
          workingMessages: [],
          toolRuns: []
        },
        updatedAt: 40
      } as never)
      // A mode this build has never heard of, as a newer version would leave.
      await db.run("UPDATE tool_loop_runs SET mode = ? WHERE requestId = ?", [
        "parallel-native",
        "req-bad"
      ])

      // Raised, not skipped: the caller is mid-resume and has to be told the
      // turn cannot be continued rather than handed a silent null.
      await expect(repo.getToolLoopRun("req-bad")).rejects.toThrow(
        /tool-loop checkpoint is invalid/
      )
    },
    TIMEOUT
  )

  it(
    "quarantines a turn row whose columns do not decode",
    async () => {
      await boot()
      const turns = await import("@/lib/repositories/turn-runs")
      const db = await import("@/lib/sqlite/db")
      await db.run(
        `INSERT INTO turn_runs
           (id, sessionId, mode, model, providerId, status, request, createdAt, updatedAt)
         VALUES ('t-bad', 's-rows', 'new', 'llama3', NULL, 'submitted', '{}', 1, 1)`
      )
      // `createdAt` is declared INTEGER but SQLite stores what it is given.
      await db.run("UPDATE turn_runs SET createdAt = ? WHERE id = ?", [
        "not-a-number",
        "t-bad"
      ])

      await expect(turns.getIncompleteTurnRuns()).resolves.toEqual([])

      // Settled rather than skipped, or recovery would re-read and re-reject it
      // on every boot forever.
      const rows = (await db.query(
        "SELECT status FROM turn_runs WHERE id = 't-bad'"
      )) as Array<{ status: string }>
      expect(rows[0]?.status).toBe("failed")
    },
    TIMEOUT
  )
})
