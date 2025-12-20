import initSqlJs, { type Database } from "sql.js"
import { SQLITE_DB_KEY, SQLITE_DB_NAME, SQLITE_DB_STORE } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { SCHEMA_SQL } from "./schema"

let db: Database | null = null
let initPromise: Promise<Database> | null = null

// Type for SQL parameter bindings
type SqlValue = string | number | null | Uint8Array
type QueryResult = Record<string, SqlValue>

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

      // Initialize sql.js with locally bundled WASM
      const SQL = await initSqlJs({
        // Load WASM from assets folder (bundled with extension)
        locateFile: (file) => chrome.runtime.getURL(`assets/${file}`)
      })

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
const scheduleAutoSave = () => {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(async () => {
    if (db) {
      try {
        await saveDatabaseToIndexedDB(db.export())
        logger.info("Database auto-saved to IndexedDB", "SQLite")
      } catch (e) {
        logger.error("Failed to auto-save database", "SQLite", { error: e })
      }
    }
  }, 1000) // Save 1 second after last change
}

/**
 * Manually save database to IndexedDB
 */
export const saveDatabase = async (): Promise<void> => {
  if (db) {
    await saveDatabaseToIndexedDB(db.export())
  }
}

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
