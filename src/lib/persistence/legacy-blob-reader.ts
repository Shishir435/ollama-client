import type { SqlJsStatic } from "sql.js"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { SQLITE_DB_KEY, SQLITE_DB_NAME, SQLITE_DB_STORE } from "@/lib/constants"
import {
  countDurableTables,
  type IntegrityReport,
  readIntegrityReport,
  type TableCounts,
  tableExistsSql
} from "./durable-tables"

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

export interface LegacySourceSurvey {
  sessions: number
  messages: number
  /** Row counts for every durable table the source actually has. */
  tables: TableCounts
  /** `PRAGMA user_version` of the source blob — the migration receipt's
   * record of which schema generation the data came from. */
  schemaVersion: number
  integrity: IntegrityReport
}

/** Open legacy bytes with sql.js and survey the rows that must survive the
 * physical import — the migration's verification source of truth. */
export const countLegacyRows = async (
  bytes: Uint8Array
): Promise<LegacySourceSurvey> => {
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
    const scalar = (sql: string): number => {
      const result = db.exec(sql)
      return Number(result[0]?.values?.[0]?.[0] ?? 0)
    }
    const rows = (sql: string): unknown[][] =>
      (db.exec(sql)[0]?.values as unknown[][] | undefined) ?? []
    const tables = countDurableTables(
      scalar,
      (table) => scalar(tableExistsSql(table)) > 0
    )
    return {
      sessions: tables.sessions ?? 0,
      messages: tables.messages ?? 0,
      tables,
      schemaVersion: scalar("PRAGMA user_version"),
      integrity: readIntegrityReport(rows)
    }
  } finally {
    db.close()
  }
}
