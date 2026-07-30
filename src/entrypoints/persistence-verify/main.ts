import type { SqlJsStatic } from "sql.js"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { browser } from "@/lib/browser-api"
import {
  SQLITE_DB_KEY,
  SQLITE_DB_NAME,
  SQLITE_DB_STORE,
  STORAGE_KEYS
} from "@/lib/constants"
import {
  invalidateBackendCache,
  readPersistenceBackend
} from "@/lib/persistence/backend"
import { DURABLE_TABLES } from "@/lib/persistence/durable-tables"
import * as chatHistory from "@/lib/repositories/sqlite-chat-history"
import {
  createFixture,
  type Scale
} from "@/lib/sqlite/benchmark/persistence-benchmark-core"
import {
  exportPersistedDatabaseBytes,
  importDatabaseBytes,
  query
} from "@/lib/sqlite/db"
import { LATEST_SCHEMA_VERSION } from "@/lib/sqlite/migrations/migration-runner"

// Dev-only verification surface for the production OPFS migration. Every
// call below exercises the REAL production path: the repository facade, the
// backend dispatcher, the persistence RPC, and the owner worker. Only the
// legacy-blob seeding writes directly, because it must reproduce what an
// unmigrated 0.11.x profile leaves behind.
//
// Extension APIs go through `browser`, never the `chrome` alias: on Firefox
// the `chrome` namespace is callback-only, so `await chrome.storage.local.get`
// resolves to undefined rather than the stored value. That made every hook
// here silently unusable on the Firefox runner while working on Chromium.

// Rows the fixture adds outside sessions/messages, so per-table migration
// verification has something to verify.
const PROMPT_TEMPLATE_SEED = 7
const KV_SEED = 3

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

const readLegacyBlobDigest = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const get = database
        .transaction([SQLITE_DB_STORE], "readonly")
        .objectStore(SQLITE_DB_STORE)
        .get(SQLITE_DB_KEY)
      get.onsuccess = async () => {
        database.close()
        if (!(get.result instanceof Uint8Array)) {
          resolve("")
          return
        }
        try {
          const bytes = Uint8Array.from(get.result)
          const digest = await crypto.subtle.digest("SHA-256", bytes.buffer)
          resolve(
            [...new Uint8Array(digest)]
              .map((value) => value.toString(16).padStart(2, "0"))
              .join("")
          )
        } catch (error) {
          reject(error)
        }
      }
      get.onerror = () => {
        database.close()
        reject(get.error)
      }
    }
  })

const verifyApi = {
  async backendMarker(): Promise<unknown> {
    const stored = await browser.storage.local.get(
      STORAGE_KEYS.PERSISTENCE.BACKEND
    )
    return stored[STORAGE_KEYS.PERSISTENCE.BACKEND] ?? null
  },

  async clearMarker(): Promise<void> {
    await browser.storage.local.remove(STORAGE_KEYS.PERSISTENCE.BACKEND)
  },

  async migrationReceipt(): Promise<unknown> {
    const stored = await browser.storage.local.get(
      STORAGE_KEYS.PERSISTENCE.MIGRATION_RECEIPT
    )
    return stored[STORAGE_KEYS.PERSISTENCE.MIGRATION_RECEIPT] ?? null
  },

  async clearMigrationReceipt(): Promise<void> {
    await browser.storage.local.remove(
      STORAGE_KEYS.PERSISTENCE.MIGRATION_RECEIPT
    )
  },

  /** Operator recovery switch, written the way an operator would: device-local
   * storage only. Read back through the production backend resolver. */
  async setLegacyOverride(enabled: boolean): Promise<void> {
    if (enabled) {
      await browser.storage.local.set({
        [STORAGE_KEYS.PERSISTENCE.LEGACY_OVERRIDE]: true
      })
      return
    }
    await browser.storage.local.remove(STORAGE_KEYS.PERSISTENCE.LEGACY_OVERRIDE)
  },

  async activeBackend(): Promise<string> {
    invalidateBackendCache()
    return readPersistenceBackend()
  },

  /** Reproduce an unmigrated profile: build a real sql.js database with the
   * section 9.8 fixture generator and persist it as the legacy blob. */
  async seedLegacyBlob(
    chats: number,
    messages: number
  ): Promise<{
    sessions: number
    messages: number
    blobBytes: number
    tables: Record<string, number>
  }> {
    const wasmUrl = browser.runtime.getURL("assets/sql-wasm.wasm")
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer()
    const SQL = await (
      initSqlJs as unknown as (config: {
        wasmBinary: Uint8Array
      }) => Promise<SqlJsStatic>
    )({ wasmBinary: new Uint8Array(wasmBinary) })
    const scale: Scale = { chats, messages }
    const fixture = createFixture(SQL, scale)
    try {
      // createFixture uses the latest schema but intentionally leaves
      // user_version at zero for benchmark portability. A current legacy
      // profile is already stamped; mirror that state here so this fixture can
      // detect migration writes to the rollback blob instead of observing the
      // legacy backend's expected one-time schema-version stamp.
      fixture.run(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION}`)
      // Seed beyond sessions/messages so migration verification is exercised
      // on tables the chat list never reads: a blob that only ever carries
      // chats cannot prove per-table verification works.
      for (let index = 0; index < PROMPT_TEMPLATE_SEED; index += 1) {
        fixture.run(
          `INSERT INTO prompt_templates
             (id, title, userPrompt, createdAt, usageCount, sortOrder)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            `verify-template-${index}`,
            `Template ${index}`,
            "prompt",
            1,
            0,
            index
          ]
        )
      }
      for (let index = 0; index < KV_SEED; index += 1) {
        fixture.run("INSERT INTO kv_store (key, value) VALUES (?, ?)", [
          `verify-key-${index}`,
          `value-${index}`
        ])
      }
      const tables: Record<string, number> = {}
      for (const table of DURABLE_TABLES) {
        const result = fixture.exec(`SELECT COUNT(*) FROM "${table}"`)
        tables[table] = Number(result[0]?.values?.[0]?.[0] ?? 0)
      }
      const bytes = fixture.export()
      await putLegacyBlob(bytes)
      return {
        sessions: chats,
        messages,
        blobBytes: bytes.byteLength,
        tables
      }
    } finally {
      fixture.close()
    }
  },

  readLegacyBlobLength,
  readLegacyBlobDigest,

  /** Row counts through the production path (facade → RPC → owner). */
  async counts(): Promise<{
    sessions: number
    messages: number
    tables: Record<string, number>
  }> {
    const tables: Record<string, number> = {}
    for (const table of DURABLE_TABLES) {
      const rows = await query(`SELECT COUNT(*) AS n FROM "${table}"`)
      tables[table] = Number(rows[0]?.n ?? 0)
    }
    return {
      sessions: tables.sessions ?? 0,
      messages: tables.messages ?? 0,
      tables
    }
  },

  /** Integrity of the live database, read through the production path. */
  async integrityInfo(): Promise<{
    integrityCheck: string
    foreignKeyViolations: number
  }> {
    const integrityRows = await query("PRAGMA integrity_check")
    const fkRows = await query("PRAGMA foreign_key_check")
    return {
      integrityCheck:
        integrityRows
          .map((row) => String(Object.values(row)[0] ?? ""))
          .filter((line) => line.length > 0)
          .join("; ") || "ok",
      foreignKeyViolations: fkRows.length
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

  /** Restore a payload that is not a usable database, through the production
   * import path. The live database must survive a rejected restore. */
  async importCorruptBackup(): Promise<{ error: string }> {
    const bytes = new TextEncoder().encode(
      "SQLite format 3 this is not a database".repeat(40)
    )
    try {
      await importDatabaseBytes(bytes)
      return { error: "" }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
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
