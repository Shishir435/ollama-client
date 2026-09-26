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
 * A resolved permission notice stays in the tree as an anchor but is not a
 * branch: stepping back to it showed an empty conversation. The flag comes
 * from `json_extract` over the stored metrics, which only the real engine can
 * answer.
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

const notice = (resolvedAt?: number) => ({
  permissionNotice: {
    capabilityId: "browserAgent" as const,
    focusId: "agent-enabled",
    labelKey: "settings.tabs.agent",
    missingPermissions: [],
    ...(resolvedAt ? { resolvedAt } : {})
  }
})

describe("the message tree", () => {
  it(
    "marks a resolved notice hidden and nothing else",
    async () => {
      vi.resetModules()
      installOwner()
      const facade = await import("@/lib/repositories/chat-history")
      await facade.addSession({
        id: "s-notice",
        title: "Notice chat",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        messages: []
      })
      const userId = await facade.addMessage({
        sessionId: "s-notice",
        role: "user",
        content: "open duckduckgo and search for try",
        timestamp: CREATED_AT
      })
      const resolvedId = await facade.addMessage({
        sessionId: "s-notice",
        role: "assistant",
        content: "The browser agent is off",
        parentId: userId,
        timestamp: CREATED_AT + 1,
        metrics: notice(CREATED_AT + 2)
      })
      const openId = await facade.addMessage({
        sessionId: "s-notice",
        role: "assistant",
        content: "The browser agent is off",
        parentId: userId,
        timestamp: CREATED_AT + 3,
        metrics: notice()
      })
      const replyId = await facade.addMessage({
        sessionId: "s-notice",
        role: "assistant",
        content: "Done.",
        parentId: userId,
        timestamp: CREATED_AT + 4
      })

      const tree = await facade.getMessageTreeBySession("s-notice")
      const hidden = Object.fromEntries(tree.map((row) => [row.id, row.hidden]))
      expect(hidden).toEqual({
        [userId]: false,
        [resolvedId]: true,
        [openId]: false,
        [replyId]: false
      })
    },
    TIMEOUT
  )
})
