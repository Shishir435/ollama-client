import type { SqlJsStatic } from "sql.js"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { browser } from "wxt/browser"
import {
  SQLITE_DB_KEY,
  SQLITE_DB_NAME,
  SQLITE_DB_STORE,
  STORAGE_KEYS
} from "@/lib/constants"
import * as chatHistory from "@/lib/repositories/sqlite-chat-history"
import {
  createFixture,
  type Scale
} from "@/lib/sqlite/benchmark/persistence-benchmark-core"
import { exportPersistedDatabaseBytes, query } from "@/lib/sqlite/db"

// Dev-only verification surface for the production OPFS migration. Every
// call below exercises the REAL production path: the repository facade, the
// backend dispatcher, the persistence RPC, and the owner worker. Only the
// legacy-blob seeding writes directly, because it must reproduce what an
// unmigrated 0.11.x profile leaves behind.

const putLegacyBlob = async (bytes: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SQLITE_DB_STORE)) {
        request.result.createObjectStore(SQLITE_DB_STORE)
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const tx = database.transaction([SQLITE_DB_STORE], "readwrite")
      tx.oncomplete = () => {
        database.close()
        resolve()
      }
      tx.onerror = () => {
        database.close()
        reject(tx.error)
      }
      tx.objectStore(SQLITE_DB_STORE).put(bytes, SQLITE_DB_KEY)
    }
  })

const readLegacyBlobLength = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SQLITE_DB_STORE)) {
        request.result.createObjectStore(SQLITE_DB_STORE)
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const get = database
        .transaction([SQLITE_DB_STORE], "readonly")
        .objectStore(SQLITE_DB_STORE)
        .get(SQLITE_DB_KEY)
      get.onsuccess = () => {
        database.close()
        resolve(get.result instanceof Uint8Array ? get.result.byteLength : 0)
      }
      get.onerror = () => {
        database.close()
        reject(get.error)
      }
    }
  })

const verifyApi = {
  async backendMarker(): Promise<unknown> {
    const stored = await chrome.storage.local.get(
      STORAGE_KEYS.PERSISTENCE.BACKEND
    )
    return stored[STORAGE_KEYS.PERSISTENCE.BACKEND] ?? null
  },

  async clearMarker(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEYS.PERSISTENCE.BACKEND)
  },

  /** Reproduce an unmigrated profile: build a real sql.js database with the
   * section 9.8 fixture generator and persist it as the legacy blob. */
  async seedLegacyBlob(
    chats: number,
    messages: number
  ): Promise<{ sessions: number; messages: number; blobBytes: number }> {
    const wasmUrl = chrome.runtime.getURL("assets/sql-wasm.wasm")
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer()
    const SQL = await (
      initSqlJs as unknown as (config: {
        wasmBinary: Uint8Array
      }) => Promise<SqlJsStatic>
    )({ wasmBinary: new Uint8Array(wasmBinary) })
    const scale: Scale = { chats, messages }
    const fixture = createFixture(SQL, scale)
    try {
      const bytes = fixture.export()
      await putLegacyBlob(bytes)
      return { sessions: chats, messages, blobBytes: bytes.byteLength }
    } finally {
      fixture.close()
    }
  },

  readLegacyBlobLength,

  /** Row counts through the production path (facade → RPC → owner). */
  async counts(): Promise<{ sessions: number; messages: number }> {
    const sessions = await query("SELECT COUNT(*) AS n FROM sessions")
    const messages = await query("SELECT COUNT(*) AS n FROM messages")
    return {
      sessions: Number(sessions[0]?.n ?? 0),
      messages: Number(messages[0]?.n ?? 0)
    }
  },

  /** Real repository write, exactly what the chat UI performs. */
  async appendViaFacade(sessionId: string, count: number): Promise<number> {
    const now = Date.now()
    await chatHistory.addSession({
      id: sessionId,
      title: `verify ${sessionId}`,
      modelId: "verify-model",
      createdAt: now,
      updatedAt: now,
      messages: []
    })
    let lastId = 0
    for (let index = 0; index < count; index += 1) {
      lastId = await chatHistory.appendMessage({
        sessionId,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `verify message ${index}`,
        timestamp: now + index
      })
    }
    return lastId
  },

  async exportInfo(): Promise<{ byteLength: number; magic: string }> {
    const bytes = await exportPersistedDatabaseBytes()
    return {
      byteLength: bytes.byteLength,
      magic: new TextDecoder().decode(bytes.slice(0, 15))
    }
  },

  reloadExtension(): void {
    browser.runtime.reload()
  }
}

declare global {
  interface Window {
    __persistenceVerify: typeof verifyApi
  }
}

window.__persistenceVerify = verifyApi
const statusLine = document.getElementById("status")
if (statusLine) statusLine.textContent = "hooks-ready"
