import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createAgentController } from "@ollama-client/agent-runtime"
import type { AgentObservation } from "@ollama-client/contracts"
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
import type { LLMProvider } from "@/lib/providers/types"
import { ProviderType } from "@/lib/providers/types"

/**
 * Starting a run against the real engine.
 *
 * Every piece below the service is already covered in isolation, and the
 * failure this catches is the one none of those see: the service reads and
 * writes durable rows before any provider work, so a start that throws there
 * reaches the panel as an unexplained refusal with no network call to show
 * for it.
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

const startService = (
  createAgentRunService: typeof import("../agent-run-service").createAgentRunService,
  runId: string
) =>
  createAgentRunService({
    sessions: {
      observe: vi.fn(),
      executeDomMutation: vi.fn(),
      executeScroll: vi.fn(),
      release: vi.fn()
    },
    buildController: () => ({
      start: vi.fn(async () => undefined),
      requestPause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      requestCancel: vi.fn(async () => undefined),
      completeTakeover: vi.fn(async () => undefined),
      answerQuestion: vi.fn(async () => undefined),
      grant: vi.fn(async () => undefined)
    }),
    hasPerception: async () => true,
    getTab: async () => ({ url: "https://example.com/start" }),
    classifyAccess: async () => "ok",
    now: () => 1_700_000_000_000,
    newRunId: () => runId
  })

describe("starting an Agent run against the real engine", () => {
  it(
    "carries a provider decision through the controller into a visible terminal snapshot",
    async () => {
      vi.resetModules()
      installOwner()
      const [{ createAgentRunService }, modelModule] = await Promise.all([
        import("../agent-run-service"),
        import("@/application/agent/agent-model-port")
      ])
      const observation: AgentObservation = {
        snapshotId: "snapshot-vertical-1",
        generation: 1,
        tabId: 7,
        frameId: 0,
        documentId: "document-vertical-1",
        url: "https://example.com/start",
        origin: "https://example.com",
        title: "Example",
        frames: [
          {
            frameId: 0,
            documentId: "document-vertical-1",
            origin: "https://example.com",
            url: "https://example.com/start",
            access: "ok",
            snapshotId: "snapshot-vertical-1",
            generation: 1
          }
        ],
        elements: [],
        visibleText: "Pricing is available.",
        scroll: {
          x: 0,
          y: 0,
          viewportWidth: 100,
          viewportHeight: 100,
          documentWidth: 100,
          documentHeight: 100
        },
        dialogs: [],
        capturedAt: 1_700_000_000_001
      }
      const provider = {
        id: "ollama",
        config: {
          id: "ollama",
          type: ProviderType.OLLAMA,
          enabled: true,
          name: "Ollama"
        },
        capabilities: {
          chat: true,
          embeddings: true,
          modelDiscovery: true,
          modelDetails: true,
          modelPull: true,
          modelUnload: true,
          modelDelete: true,
          providerVersion: true,
          toolCalling: true
        },
        async streamChat(_request, emit) {
          emit({
            toolCalls: [
              {
                id: "decision-1",
                name: "agent_decision",
                arguments: {
                  type: "complete",
                  summary: "Pricing page found."
                }
              }
            ],
            done: true
          })
        },
        getModels: async () => []
      } satisfies LLMProvider
      const service = createAgentRunService({
        hasPerception: async () => true,
        getTab: async () => ({ url: observation.url }),
        classifyAccess: async () => "ok",
        now: () => 1_700_000_000_001,
        newRunId: () => "run-vertical-1",
        buildController: ({ persistence, now }) =>
          createAgentController({
            persistence,
            model: modelModule.createProviderAgentModelPort({
              resolveProvider: async () => provider,
              resolveCompatibility: async () => ({
                status: "supported",
                mode: "native",
                reason: "metadata"
              })
            }),
            observation: { observe: async () => observation },
            effect: {
              resolve: async () => {
                throw new Error("complete decisions resolve no effect")
              },
              execute: async () => {
                throw new Error("complete decisions execute no effect")
              },
              verify: async () => {
                throw new Error("complete decisions verify no effect")
              }
            },
            policy: {
              evaluate: () => {
                throw new Error("complete decisions invoke no policy")
              }
            },
            approval: {
              request: async () => {
                throw new Error("complete decisions request no approval")
              }
            },
            takeover: {
              request: async () => {
                throw new Error("complete decisions request no takeover")
              }
            },
            clock: { now }
          })
      })

      await service.start({
        goal: "Find pricing",
        tabId: 7,
        providerId: "ollama",
        modelId: "qwen3"
      })

      await vi.waitFor(async () => {
        const snapshot = await service.snapshot("run-vertical-1")
        expect(snapshot.run).toMatchObject({
          status: "completed",
          result: "Pricing page found."
        })
      })
    },
    TIMEOUT
  )

  it(
    "writes the run and reports it back to the panel",
    async () => {
      vi.resetModules()
      installOwner()
      const { createAgentRunService } = await import("../agent-run-service")

      const controller = {
        start: vi.fn(async () => undefined),
        requestPause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        requestCancel: vi.fn(async () => undefined),
        completeTakeover: vi.fn(async () => undefined),
        answerQuestion: vi.fn(async () => undefined),
        grant: vi.fn(async () => undefined)
      }
      const service = createAgentRunService({
        sessions: {
          observe: vi.fn(),
          executeDomMutation: vi.fn(),
          executeScroll: vi.fn(),
          release: vi.fn()
        },
        buildController: () => controller,
        hasPerception: async () => true,
        getTab: async () => ({ url: "https://example.com/start" }),
        classifyAccess: async () => "ok",
        now: () => 1_700_000_000_000,
        newRunId: () => "run-smoke-1"
      })

      const state = await service.start({
        goal: "Click any button on this page",
        tabId: 7,
        providerId: "ollama",
        modelId: "qwen3"
      })

      expect(state.id).toBe("run-smoke-1")
      expect(controller.start).toHaveBeenCalledWith("run-smoke-1")

      const snapshot = await service.snapshot("run-smoke-1")
      expect(snapshot.run).toMatchObject({
        id: "run-smoke-1",
        status: "submitted",
        allowedOrigins: ["https://example.com"]
      })
      expect(snapshot.steps).toEqual([])

      await expect(
        service.start({
          goal: "Another task",
          tabId: 7,
          providerId: "ollama",
          modelId: "qwen3"
        })
      ).rejects.toThrow("already unresolved")

      /*
       * A fresh service is what the next MV3 worker sees: no in-memory flag,
       * so the refusal has to come from the durable rows, and that read is
       * the one thing between the panel's Start and a real SQL error.
       */
      const restarted = createAgentRunService({
        sessions: {
          observe: vi.fn(),
          executeDomMutation: vi.fn(),
          executeScroll: vi.fn(),
          release: vi.fn()
        },
        buildController: () => controller,
        hasPerception: async () => true,
        getTab: async () => ({ url: "https://example.com/start" }),
        classifyAccess: async () => "ok",
        now: () => 1_700_000_000_001,
        newRunId: () => "run-smoke-2"
      })

      await expect(
        restarted.start({
          goal: "Another task",
          tabId: 7,
          providerId: "ollama",
          modelId: "qwen3"
        })
      ).rejects.toThrow("already unresolved")
      expect(restarted.activeRunId()).toBe("run-smoke-1")
    },
    TIMEOUT
  )

  it(
    "shows the last run to a worker that did not start it",
    async () => {
      vi.resetModules()
      installOwner()
      const first = await import("../agent-run-service")
      await startService(first.createAgentRunService, "run-smoke-4").start({
        goal: "Click any button on this page",
        tabId: 7,
        providerId: "ollama",
        modelId: "qwen3"
      })
      const db = await import("@/lib/sqlite/db")
      await db.flushSave()

      /*
       * The MV3 worker that ran it is gone; a run the user can no longer see
       * is a run they cannot tell apart from nothing having happened.
       */
      vi.resetModules()
      installOwner()
      const restarted = await import("../agent-run-service")
      const service = startService(
        restarted.createAgentRunService,
        "run-smoke-5"
      )

      await expect(service.latestRunId()).resolves.toBe("run-smoke-4")
      const snapshot = await service.snapshot("run-smoke-4")
      expect(snapshot.run?.goal).toBe("Click any button on this page")
    },
    TIMEOUT
  )

  it(
    "starts on a profile whose Agent tables were left by an older build",
    async () => {
      vi.resetModules()
      installOwner()
      const db = await import("@/lib/sqlite/db")

      /*
       * A pre-release Agent build's table, which `CREATE TABLE IF NOT EXISTS`
       * will never correct: it exists, so every shipped query against it
       * answers "no such column".
       */
      await db.run("DROP TABLE IF EXISTS agent_steps")
      await db.run("DROP TABLE IF EXISTS agent_runs")
      await db.run(
        `CREATE TABLE agent_runs (
           id TEXT PRIMARY KEY,
           status TEXT NOT NULL,
           state TEXT NOT NULL,
           createdAt INTEGER NOT NULL,
           updatedAt INTEGER NOT NULL
         )`
      )
      await db.flushSave()

      vi.resetModules()
      installOwner()
      const { createAgentRunService } = await import("../agent-run-service")

      const state = await startService(
        createAgentRunService,
        "run-smoke-3"
      ).start({
        goal: "Click any button on this page",
        tabId: 7,
        providerId: "ollama",
        modelId: "qwen3"
      })

      expect(state.id).toBe("run-smoke-3")
    },
    TIMEOUT
  )
})
