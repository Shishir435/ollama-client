import type { SqlJsStatic } from "sql.js"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { SQLITE_DB_KEY, SQLITE_DB_NAME, SQLITE_DB_STORE } from "@/lib/constants"

// Migration-time compatibility reader for the legacy sql.js IndexedDB blob.
// Loaded lazily (dynamic import) so sql.js stays out of every startup chunk
// once a profile has migrated. Also used by old-format backup import, which
// carries a database.sqlite produced by sql.js.

export const readLegacyBlobBytes = async (): Promise<Uint8Array | null> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(SQLITE_DB_STORE)) {
        database.createObjectStore(SQLITE_DB_STORE)
      }
    }
    request.onsuccess = () => {
      const database = request.result
      try {
        const get = database
          .transaction([SQLITE_DB_STORE], "readonly")
          .objectStore(SQLITE_DB_STORE)
          .get(SQLITE_DB_KEY)
        get.onsuccess = () => {
          database.close()
          resolve(get.result instanceof Uint8Array ? get.result : null)
        }
        get.onerror = () => {
          database.close()
          reject(get.error)
        }
      } catch (error) {
        database.close()
        reject(error)
      }
    }
  })

/** Open legacy bytes with sql.js and count the rows that must survive the
 * physical import — the migration's verification source of truth. */
export const countLegacyRows = async (
  bytes: Uint8Array
): Promise<{ sessions: number; messages: number }> => {
  const wasmUrl = chrome.runtime.getURL("assets/sql-wasm.wasm")
  const response = await fetch(wasmUrl)
  const wasmBinary = await response.arrayBuffer()
  const SQL = await (
    initSqlJs as unknown as (config: {
      wasmBinary: Uint8Array
    }) => Promise<SqlJsStatic>
  )({ wasmBinary: new Uint8Array(wasmBinary) })

  const db = new SQL.Database(bytes)
  try {
    const count = (sql: string): number => {
      const result = db.exec(sql)
      return Number(result[0]?.values?.[0]?.[0] ?? 0)
    }
    return {
      sessions: count("SELECT COUNT(*) FROM sessions"),
      messages: count("SELECT COUNT(*) FROM messages")
    }
  } finally {
    db.close()
  }
}
