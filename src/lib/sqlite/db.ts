import type { SqlJsStatic } from "sql.js"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { SQLITE_DB_KEY, SQLITE_DB_NAME, SQLITE_DB_STORE } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { ensureMessagesThinkingColumn } from "./migrations/add-thinking-column"
import { SCHEMA_SQL } from "./schema"

// Dynamic type for Database
type Database = import("sql.js").Database

let db: Database | null = null
let initPromise: Promise<Database> | null = null
let loadedImportGeneration: string | null = null

// Type for SQL parameter bindings
type SqlValue = string | number | null | Uint8Array
type QueryResult = Record<string, SqlValue>

const SQLITE_DB_IMPORT_GENERATION_KEY = "sqlite-db-import-generation"

const getDatabaseImportGeneration = async (): Promise<string | null> => {
  try {
    const data = await chrome.storage.local.get(SQLITE_DB_IMPORT_GENERATION_KEY)
    const value = data?.[SQLITE_DB_IMPORT_GENERATION_KEY]
    return typeof value === "string" ? value : null
  } catch (error) {
    logger.warn("Failed to read SQLite import generation", "SQLite", { error })
    return null
  }
}

const bumpDatabaseImportGeneration = async (): Promise<string> => {
  const nextGeneration =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  await chrome.storage.local.set({
    [SQLITE_DB_IMPORT_GENERATION_KEY]: nextGeneration
  })
  return nextGeneration
}

const canPersistLoadedDatabase = async (): Promise<boolean> => {
  const currentGeneration = await getDatabaseImportGeneration()
  const canPersist = currentGeneration === loadedImportGeneration
  if (!canPersist) {
    logger.warn(
      "Skipping SQLite save from stale context after backup restore",
      "SQLite"
    )
  }
  return canPersist
}

/**
 * Load database from IndexedDB
 */
async function loadDatabaseFromIndexedDB(): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction([SQLITE_DB_STORE], "readonly")
      const store = transaction.objectStore(SQLITE_DB_STORE)
      const getRequest = store.get(SQLITE_DB_KEY)

      getRequest.onsuccess = () => resolve(getRequest.result || null)
      getRequest.onerror = () => resolve(null)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(SQLITE_DB_STORE)) {
        db.createObjectStore(SQLITE_DB_STORE)
      }
    }
  })
}

/**
 * Save database to IndexedDB
 */
async function saveDatabaseToIndexedDB(data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction([SQLITE_DB_STORE], "readwrite")
      const store = transaction.objectStore(SQLITE_DB_STORE)
      const putRequest = store.put(data, SQLITE_DB_KEY)

      putRequest.onsuccess = () => resolve()
      putRequest.onerror = () => reject(putRequest.error)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(SQLITE_DB_STORE)) {
        db.createObjectStore(SQLITE_DB_STORE)
      }
    }
  })
}

export const initSQLite = async (): Promise<Database> => {
  if (db) return db
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      logger.info("Initializing SQLite (sql.js)...", "SQLite")

      const wasmUrl = chrome.runtime.getURL("assets/sql-wasm.wasm")
      const response = await fetch(wasmUrl)
      const wasmBinary = await response.arrayBuffer()

      const SQL = await (
        initSqlJs as unknown as (config: {
          wasmBinary: Uint8Array
        }) => Promise<SqlJsStatic>
      )({
        wasmBinary: new Uint8Array(wasmBinary)
      })
      loadedImportGeneration = await getDatabaseImportGeneration()

      // Try to load existing database from IndexedDB
      const savedDb = await loadDatabaseFromIndexedDB()

      if (savedDb) {
        logger.info("Loaded existing database from IndexedDB", "SQLite")
        db = new SQL.Database(savedDb)
      } else {
        logger.info("Creating new database", "SQLite")
        db = new SQL.Database()

        // Run schema migrations
        logger.info("Running Migrations...", "SQLite")
        db.run(SCHEMA_SQL)

        // Save initial database
        await saveDatabaseToIndexedDB(db.export())
      }

      // Idempotent per-column migrations. New databases get all columns
      // from SCHEMA_SQL above; databases created before a column was
      // added get the ALTER TABLE on the next open.
      ensureMessagesThinkingColumn(db)

      logger.info("SQLite initialized successfully", "SQLite")
      return db
    } catch (e) {
      logger.error("Failed to initialize SQLite", "SQLite", { error: e })
      throw e
    }
  })()

  return initPromise
}

export const getDb = async (): Promise<Database> => {
  if (!db) {
    return initSQLite()
  }
  return db
}

/**
 * Utility to run a query and return array of objects
 */
export const query = async (
  sql: string,
  bind: SqlValue[] = []
): Promise<QueryResult[]> => {
  const database = await getDb()
  const stmt = database.prepare(sql)
  stmt.bind(bind)

  const results: QueryResult[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()

  return results
}

/**
 * Utility to run a command (INSERT, UPDATE, DELETE)
 */
export const run = async (
  sql: string,
  bind: SqlValue[] = []
): Promise<void> => {
  const database = await getDb()
  const stmt = database.prepare(sql)
  stmt.bind(bind)
  stmt.step()
  stmt.free()

  // Trigger auto-save after write operations
  scheduleAutoSave()
}

// Auto-save scheduling
let saveTimeout: NodeJS.Timeout | null = null
const cancelPendingAutoSave = () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
}
const scheduleAutoSave = () => {
  cancelPendingAutoSave()
  saveTimeout = setTimeout(async () => {
    saveTimeout = null
    if (db) {
      try {
        if (!(await canPersistLoadedDatabase())) return
        await saveDatabaseToIndexedDB(db.export())
        logger.info("Database auto-saved to IndexedDB", "SQLite")
      } catch (e) {
        logger.error("Failed to auto-save database", "SQLite", { error: e })
      }
    }
  }, 1000) // Save 1 second after last change
}

/**
 * Force-flush any in-memory writes to IndexedDB *now*, cancelling any
 * pending debounced auto-save. Use this at boundaries where the next
 * operation will rely on the data being durable:
 *
 *   - end of a migration (before persisting "migration completed")
 *   - before exposing newly imported SQLite chat data
 *   - on page/sidepanel unload
 *
 * No-op if no database is open yet.
 */
export const flushSave = async (): Promise<void> => {
  cancelPendingAutoSave()
  if (!db) return
  if (!(await canPersistLoadedDatabase())) return
  await saveDatabaseToIndexedDB(db.export())
  logger.info("Database flushed to IndexedDB", "SQLite")
}

/**
 * Manually save database to IndexedDB. Alias of `flushSave` kept for
 * existing callers (feedback-service); both cancel the pending
 * debounce so a stale in-flight write can't clobber the explicit save.
 */
export const saveDatabase = flushSave

/**
 * Export raw database bytes for backup
 */
export const exportDatabaseBytes = async (): Promise<Uint8Array> => {
  const database = await getDb()
  return database.export()
}

/**
 * Export the durable IndexedDB copy directly. Backup export calls this after
 * asking live extension pages to flush, so it does not accidentally read a
 * stale in-memory SQL.js instance from the Options page.
 */
export const exportPersistedDatabaseBytes = async (): Promise<Uint8Array> => {
  const savedDb = await loadDatabaseFromIndexedDB()
  if (savedDb) return savedDb
  return exportDatabaseBytes()
}

/**
 * Import raw database bytes from backup and reload memory DB
 */
export const importDatabaseBytes = async (bytes: Uint8Array): Promise<void> => {
  logger.info("Importing database bytes...", "SQLite")

  cancelPendingAutoSave()
  const nextGeneration = await bumpDatabaseImportGeneration()

  // Save to IndexedDB
  await saveDatabaseToIndexedDB(bytes)

  // Reset singletons to force reload
  db = null
  initPromise = null
  loadedImportGeneration = nextGeneration

  // Reinitialize DB
  await initSQLite()
  logger.info("Database imported successfully", "SQLite")
}

/**
 * Drop the entire SQLite-backed chat database. Deletes the
 * IndexedDB store that holds the persisted SQLite blob, then resets
 * the in-memory singleton. The next call to `getDb()` reinitializes
 * from scratch via `initSQLite()` -> SCHEMA_SQL.
 *
 * Used by the user-facing "reset all app data" flow.
 */
export const resetSQLiteDatabase = async (): Promise<void> => {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
  if (db) {
    try {
      db.close()
    } catch (e) {
      logger.warn("Failed to close SQLite database before reset", "SQLite", {
        error: e
      })
    }
  }
  db = null
  initPromise = null
  loadedImportGeneration = await bumpDatabaseImportGeneration()

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SQLITE_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      // Other tabs hold an open handle; the delete will complete once
      // they close. Resolve optimistically — the caller usually reloads.
      logger.warn(
        "deleteDatabase blocked by an open connection; will complete when handles close",
        "SQLite"
      )
      resolve()
    }
  })
  logger.info("SQLite database reset", "SQLite")
}

/**
 * Register a one-time unload listener that force-flushes the SQLite
 * blob to IndexedDB before the page/sidepanel context tears down.
 *
 * Why this matters: every `run()` schedules a debounced auto-save 1s
 * out (intentional, so streaming a long reply doesn't write to disk
 * on every token). The catch is that the JS context can die in that
 * 1-second window — the user closes the sidepanel, the browser
 * suspends the service worker, etc. — and the in-memory writes go
 * with it. `pagehide` and `visibilitychange=hidden` are the most
 * reliable single-shot hooks we have for that boundary.
 *
 * `flushSave()` returns a Promise; both events let the browser keep
 * the IndexedDB transaction alive long enough to complete in
 * practice, which is all we need.
 */
const registerUnloadFlush = () => {
  if (typeof globalThis === "undefined") return
  const target = globalThis as unknown as {
    addEventListener?: (type: string, listener: () => void) => void
    document?: {
      addEventListener?: (type: string, listener: () => void) => void
      visibilityState?: string
    }
  }
  const flush = () => {
    flushSave().catch((e) => {
      logger.warn("Unload flush failed", "SQLite", { error: e })
    })
  }
  if (typeof target.addEventListener === "function") {
    target.addEventListener("pagehide", flush)
    target.addEventListener("beforeunload", flush)
  }
  if (target.document?.addEventListener) {
    target.document.addEventListener("visibilitychange", () => {
      if (target.document?.visibilityState === "hidden") flush()
    })
  }
}
registerUnloadFlush()

const isDevelopment = process.env.NODE_ENV === "development"

if (isDevelopment) {
  const globalAny = (typeof window !== "undefined"
    ? window
    : self) as unknown as {
    sqlite: Record<string, unknown>
  }
  globalAny.sqlite = { query, run, getDb, initSQLite, saveDatabase }
  logger.info("SQLite Debug Tools exposed at window.sqlite", "SQLite")
}
