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

describe("starting an Agent run against the real engine", () => {
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
        completeTakeover: vi.fn(async () => undefined)
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
})
