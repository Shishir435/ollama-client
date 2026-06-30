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
import { OpenAICompatibleProvider } from "@/lib/providers/openai-compatible"
import {
  ProviderId,
  ProviderStorageKey,
  ProviderType
} from "@/lib/providers/types"

/**
 * Functional durability smoke (PROJECT_PLAN S1/S2).
 *
 * Unlike the rest of the repository tests — which mock `@/lib/sqlite/db`
 * to capture SQL strings — this suite boots the REAL sql.js engine against
 * the real `fake-indexeddb` global and drives the public chat-history
 * facade. It is the regression net for the data-durability fires the
 * 0.11.x line fixed:
 *
 *   S1 — write -> flush -> "service-worker restart" -> data still readable.
 *   S2 — reset drops the chat DB, and the reset map targets API keys.
 *
 * A service-worker restart is simulated with `vi.resetModules()`: that drops
 * the module-level in-memory `Database` singleton (back to `db = null`) while
 * the persisted blob lives on in the process-global `fake-indexeddb`. The
 * next facade import re-runs `initSQLite()`, which reloads from IndexedDB —
 * exactly the cold-start path a suspended SW takes.
 *
 * Note on cleanup: production's IndexedDB helpers open a connection per call
 * and never close it. That's fine in a real browser (handles are GC'd), but
 * under fake-indexeddb the lingering handles make `deleteDatabase` block
 * forever. So we isolate tests by *clearing the object store* (a plain
 * read/write txn, never blocked) rather than deleting the database, and we
 * assert the reset path via a `deleteDatabase` spy instead of a post-reset
 * reload (whose `open()` would queue behind the blocked delete).
 */

const TIMEOUT = 25_000

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm")
let wasmBuffer: ArrayBuffer

beforeAll(() => {
  const wasm = readFileSync(wasmPath)
  wasmBuffer = wasm.buffer.slice(
    wasm.byteOffset,
    wasm.byteOffset + wasm.byteLength
  )
})

const stubWasmFetch = () => {
  // db.ts fetches the wasm via chrome.runtime.getURL(...) then .arrayBuffer().
  // Serve the real binary so the engine boots without a network/extension host.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => wasmBuffer
    }))
  )
}

const streamResponse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      }
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

// Empty the persisted blob without deleting the database (delete blocks under
// fake-indexeddb, see file header). Closes the connection it opens.
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
  stubWasmFetch()
}, TIMEOUT)

// Re-import the facade + db module fresh. After `vi.resetModules()` this
// returns a brand-new module graph whose `db` singleton is null, forcing a
// reload from the persisted IndexedDB blob — i.e. a simulated SW cold start.
const bootFreshContext = async () => {
  vi.resetModules()
  const facade = await import("@/lib/repositories/chat-history")
  const db = await import("@/lib/sqlite/db")
  return { facade, db }
}

const makeSession = (id: string) => ({
  id,
  title: "Durable session",
  modelId: "llama3.2:3b",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  messages: []
})

describe("S1 — chat-history survives a service-worker restart", () => {
  it(
    "persists a flushed session + message across a cold reload",
    async () => {
      const first = await bootFreshContext()
      await first.facade.addSession(makeSession("s-durable"))
      await first.facade.addMessage({
        sessionId: "s-durable",
        role: "user",
        content: "hello durable world",
        timestamp: 1_700_000_000_001
      })

      // Force the durability path instead of waiting on the 1s debounce.
      await first.db.flushSave()

      // Simulate the SW being suspended and woken: fresh module graph, same IDB.
      const second = await bootFreshContext()
      const sessions = await second.facade.getAllSessions()
      expect(sessions.map((s) => s.id)).toContain("s-durable")

      const messages = await second.facade.getMessagesBySession("s-durable")
      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe("hello durable world")
    },
    TIMEOUT
  )

  it(
    "cascades message deletes via PRAGMA foreign_keys=ON after reload",
    async () => {
      const first = await bootFreshContext()
      await first.facade.addSession(makeSession("s-cascade"))
      await first.facade.addMessage({
        sessionId: "s-cascade",
        role: "user",
        content: "orphan me",
        timestamp: 1_700_000_000_002
      })
      await first.db.flushSave()

      const second = await bootFreshContext()
      await second.facade.deleteSessionRow("s-cascade")

      // FK cascade (not an explicit message delete) must clear the children.
      const messages = await second.facade.getMessagesBySession("s-cascade")
      expect(messages).toHaveLength(0)
    },
    TIMEOUT
  )
})

describe("S2 — reset actually wipes data", () => {
  it(
    "drops the chat database when reset is invoked",
    async () => {
      const { facade, db } = await bootFreshContext()
      await facade.addSession(makeSession("s-wipe"))
      await facade.addMessage({
        sessionId: "s-wipe",
        role: "user",
        content: "should not survive reset",
        timestamp: 1_700_000_000_003
      })
      await db.flushSave()

      // Stub the actual delete so it resolves immediately. A real
      // deleteDatabase blocks under fake-indexeddb (lingering prod handles)
      // and would leave a pending delete that hangs the next test's setup.
      const fakeRequest = {} as IDBOpenDBRequest
      const deleteSpy = vi
        .spyOn(indexedDB, "deleteDatabase")
        .mockImplementation(() => {
          queueMicrotask(() => fakeRequest.onsuccess?.(new Event("success")))
          return fakeRequest
        })
      try {
        await db.resetSQLiteDatabase()
        expect(deleteSpy).toHaveBeenCalledWith(SQLITE_DB_NAME)
      } finally {
        deleteSpy.mockRestore()
      }
    },
    TIMEOUT
  )

  it("includes provider API keys in the reset key map", async () => {
    const { getAllResetKeys } = await import("@/lib/get-all-reset-keys")
    const map = getAllResetKeys()
    const allKeys = Object.values(map).flat()

    // The bug this guards: ProviderStorageKey.CONFIG (holds API keys) was in
    // no reset map, so "reset provider data" left stored keys behind.
    expect(allKeys).toContain(ProviderStorageKey.CONFIG)
    expect(allKeys).toContain(ProviderStorageKey.MODEL_MAPPINGS)

    // The other reset bug: Object.values() on a top-level *string* key
    // exploded it into per-character garbage. No real storage key is a
    // single character, so any 1-char entry means the regression is back.
    expect(
      allKeys.every((key) => typeof key === "string" && key.length > 1)
    ).toBe(true)
  })
})

describe("S3 — provider round-trip persists after reload", () => {
  it(
    "streams from a mock OpenAI-compatible provider and persists the reply",
    async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = input.toString()
          if (url.includes("/chat/completions")) {
            return streamResponse([
              `data: ${JSON.stringify({
                choices: [{ delta: { content: "hello " } }]
              })}\n\n`,
              `data: ${JSON.stringify({
                choices: [{ delta: { content: "from mock" } }]
              })}\n\n`,
              "data: [DONE]\n\n"
            ])
          }

          return {
            ok: true,
            arrayBuffer: async () => wasmBuffer
          }
        })
      )

      const first = await bootFreshContext()
      await first.facade.addSession(makeSession("s-provider-round-trip"))
      await first.facade.addMessage({
        sessionId: "s-provider-round-trip",
        role: "user",
        content: "say hello",
        timestamp: 1_700_000_000_004
      })

      const provider = new OpenAICompatibleProvider({
        id: ProviderId.OPENAI,
        name: "Mock local OpenAI-compatible",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "http://localhost:3210/v1"
      })

      let content = ""
      await provider.streamChat(
        {
          model: "mock-model",
          messages: [{ role: "user", content: "say hello" }]
        },
        (chunk) => {
          content += chunk.delta ?? ""
        }
      )

      expect(content).toBe("hello from mock")

      await first.facade.addMessage({
        sessionId: "s-provider-round-trip",
        role: "assistant",
        content,
        timestamp: 1_700_000_000_005,
        done: true
      })
      await first.db.flushSave()

      const second = await bootFreshContext()
      const messages = await second.facade.getMessagesBySession(
        "s-provider-round-trip"
      )
      expect(messages.map((m) => m.content)).toEqual([
        "say hello",
        "hello from mock"
      ])
    },
    TIMEOUT
  )
})
