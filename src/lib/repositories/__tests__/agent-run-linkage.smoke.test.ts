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
 * The commit that ties a run to the conversation it belongs to, driven against
 * the real engine.
 *
 * Every state this covers is one a worker dying at the wrong moment used to
 * produce, and none of them can be asserted against mocks: what is being tested
 * is that SQLite either has all of the rows or none of them.
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
  goal: "Compare the two plans",
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
  const facade = await import("@/lib/repositories/chat-history")
  await facade.addSession({
    id: "s-agent",
    title: "Agent chat",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    messages: []
  })
  const runs = await import("@/lib/repositories/agent-runs")
  const { createLinkedAgentRun } = await import(
    "@/background/agent/agent-run-linkage"
  )
  return { facade, runs, createLinkedAgentRun }
}

describe("an Agent run and the conversation it belongs to", () => {
  it(
    "writes the request, its card and the run in one commit",
    async () => {
      const { facade, runs, createLinkedAgentRun } = await boot()

      await createLinkedAgentRun(runState("agent-link-1"), "s-agent")

      const messages = await facade.getMessagesBySession("s-agent")
      expect(messages.map((message) => message.role)).toEqual([
        "user",
        "assistant"
      ])
      expect(messages[0]?.content).toBe("Compare the two plans")
      expect(messages[1]?.done).toBe(false)
      expect(messages[1]?.agentRunId).toBe("agent-link-1")

      const run = await runs.getAgentRun("agent-link-1")
      expect(run?.sessionId).toBe("s-agent")
      expect(run?.requestMessageId).toBe(messages[0]?.id)
      expect(run?.resultMessageId).toBe(messages[1]?.id)

      /* The card is where the conversation continues from. */
      const session = await facade.getSession("s-agent")
      expect(session?.currentLeafId).toBe(messages[1]?.id)
    },
    TIMEOUT
  )

  it(
    "starts the run anyway when the chat cannot be found",
    async () => {
      const { facade, runs, createLinkedAgentRun } = await boot()

      await createLinkedAgentRun(runState("agent-link-2"), "s-missing")

      expect(await facade.getMessagesBySession("s-missing")).toEqual([])
      const run = await runs.getAgentRun("agent-link-2")
      expect(run?.status).toBe("submitted")
      expect(run?.sessionId).toBeUndefined()
    },
    TIMEOUT
  )

  it(
    "settles the card in the commit that settles the run",
    async () => {
      const { facade, runs, createLinkedAgentRun } = await boot()
      await createLinkedAgentRun(runState("agent-link-3"), "s-agent")

      await runs.transitionAgentRun({
        runId: "agent-link-3",
        from: "submitted",
        to: "failed",
        patch: { result: "Plan B costs less", updatedAt: CREATED_AT + 10 }
      })

      const messages = await facade.getMessagesBySession("s-agent")
      expect(messages[1]?.done).toBe(true)
      expect(messages[1]?.content).toBe("Plan B costs less")
    },
    TIMEOUT
  )

  it(
    "keeps the receipts when a branch of the conversation is deleted",
    async () => {
      const { facade, runs, createLinkedAgentRun } = await boot()
      await createLinkedAgentRun(runState("agent-link-4"), "s-agent")
      const messages = await facade.getMessagesBySession("s-agent")
      const requestId = messages[0]?.id as number

      const deleted = await facade.deleteMessageSubtree(requestId)
      await runs.orphanAgentRunMessages(deleted?.messageIds ?? [])

      const run = await runs.getAgentRun("agent-link-4")
      expect(run).not.toBeNull()
      expect(run?.requestMessageId).toBeUndefined()
      expect(run?.resultMessageId).toBeUndefined()
      expect(run?.sessionId).toBe("s-agent")
    },
    TIMEOUT
  )

  it(
    "takes the run with the chat when the chat is deleted",
    async () => {
      const { runs, createLinkedAgentRun } = await boot()
      await createLinkedAgentRun(runState("agent-link-5"), "s-agent")
      await runs.appendAgentStep({
        runId: "agent-link-5",
        stepId: "agent-link-5:1",
        status: "planned",
        command: { type: "back", snapshotId: "snapshot-1", generation: 1 },
        at: CREATED_AT + 1
      })

      expect(await runs.deleteAgentRunsForSession("s-agent")).toBe(1)

      expect(await runs.getAgentRun("agent-link-5")).toBeNull()
      expect(await runs.listAgentSteps("agent-link-5")).toEqual([])
    },
    TIMEOUT
  )

  it(
    "finishes a card the worker died before settling",
    async () => {
      const { facade, runs, createLinkedAgentRun } = await boot()
      await createLinkedAgentRun(runState("agent-link-6"), "s-agent")
      /*
       * The shape a worker lost between the two writes leaves behind: the run
       * is settled and its card is still waiting. Nothing later knows to look,
       * so startup asks.
       */
      const db = await import("@/lib/sqlite/db")
      await db.run(
        "UPDATE agent_runs SET status = 'completed' WHERE id = 'agent-link-6'"
      )

      await runs.reconcileAgentRunLinkage()

      const messages = await facade.getMessagesBySession("s-agent")
      expect(messages[1]?.done).toBe(true)
    },
    TIMEOUT
  )

  it(
    "drops pointers to messages that no longer exist",
    async () => {
      const { facade, runs, createLinkedAgentRun } = await boot()
      await createLinkedAgentRun(runState("agent-link-7"), "s-agent")
      const messages = await facade.getMessagesBySession("s-agent")

      /* A delete that never told the background — a lost event, or a crash. */
      await facade.deleteMessageSubtree(messages[0]?.id as number)
      await runs.reconcileAgentRunLinkage()

      const run = await runs.getAgentRun("agent-link-7")
      expect(run?.requestMessageId).toBeUndefined()
      expect(run?.resultMessageId).toBeUndefined()
    },
    TIMEOUT
  )
})
