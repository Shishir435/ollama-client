import { logger } from "@/lib/logger"
import { readPersistenceBackend } from "@/lib/persistence/backend"
import {
  rpcExportDb,
  rpcImportDb,
  rpcPing,
  rpcQuery,
  rpcReset,
  rpcRun,
  rpcTxBegin,
  rpcTxCommit,
  rpcTxRollback
} from "@/lib/persistence/client"
import type { RunResult } from "@/lib/persistence/protocol"

// Chat-history database facade. Dispatches every operation to the profile's
// active backend:
//
//   "opfs"   — the production single-owner topology: one sqlite-wasm database
//              behind opfs-sahpool, hosted by the Chromium offscreen document
//              or the Firefox MV2 background page, reached over persistence
//              RPC. Durability is per-transaction; there is no debounced
//              full-blob save and no stale-writer hazard.
//   "legacy" — the historical in-memory sql.js database persisted as one
//              IndexedDB blob. Only active until the owner's one-time
//              migration verifies row counts and flips the backend marker.
//
// The legacy implementation is loaded lazily so sql.js and its WASM stay out
// of every startup chunk on migrated profiles.

type SqlValue = string | number | null | Uint8Array
type QueryResult = Record<string, SqlValue>

type LegacyDb = typeof import("./legacy-db")

let legacyPromise: Promise<LegacyDb> | null = null
const legacy = (): Promise<LegacyDb> => {
  if (!legacyPromise) legacyPromise = import("./legacy-db")
  return legacyPromise
}

const isOpfs = async (): Promise<boolean> =>
  (await readPersistenceBackend()) === "opfs"

// ---------------------------------------------------------------------------
// Transaction scope. The OPFS worker grants a transaction lease keyed by a
// client token; every query/run issued inside withTransaction carries it so
// the owner can park other clients' statements until commit. One transaction
// at a time per context (local mutex) — same constraint the legacy
// transactionDepth counter imposed.
// ---------------------------------------------------------------------------

let currentTxToken: string | null = null
let txMutex: Promise<void> = Promise.resolve()

export const withTransaction = async (
  work: () => Promise<void>
): Promise<void> => {
  if (!(await isOpfs())) {
    const legacyDb = await legacy()
    await legacyDb.run("BEGIN IMMEDIATE")
    try {
      await work()
      await legacyDb.run("COMMIT")
    } catch (error) {
      await legacyDb.run("ROLLBACK")
      throw error
    }
    return
  }

  const previous = txMutex
  let release: () => void = () => {}
  txMutex = new Promise((resolve) => {
    release = resolve
  })
  await previous

  const token = crypto.randomUUID()
  try {
    await rpcTxBegin(token)
    currentTxToken = token
    try {
      await work()
      await rpcTxCommit(token)
    } catch (error) {
      try {
        await rpcTxRollback(token)
      } catch (rollbackError) {
        logger.warn("Transaction rollback failed", "SQLite", {
          error: rollbackError
        })
      }
      throw error
    }
  } finally {
    currentTxToken = null
    release()
  }
}

// ---------------------------------------------------------------------------
// Core statement API (signature-compatible with the legacy module)
// ---------------------------------------------------------------------------

export const query = async (
  sql: string,
  bind: SqlValue[] = []
): Promise<QueryResult[]> => {
  if (await isOpfs()) {
    return (await rpcQuery(
      sql,
      bind,
      currentTxToken ?? undefined
    )) as QueryResult[]
  }
  return (await legacy()).query(sql, bind)
}

export const run = async (
  sql: string,
  bind: SqlValue[] = []
): Promise<void> => {
  if (await isOpfs()) {
    await rpcRun(sql, bind, currentTxToken ?? undefined)
    return
  }
  return (await legacy()).run(sql, bind)
}

/**
 * Run a mutating statement and atomically report its lastInsertRowid and
 * change count. On the shared OPFS connection this is the only race-free way
 * to read last_insert_rowid(); the legacy per-context database reads it with
 * a follow-up query, which is safe there because nothing else shares the
 * connection.
 */
export const runWithMeta = async (
  sql: string,
  bind: SqlValue[] = []
): Promise<RunResult> => {
  if (await isOpfs()) {
    return rpcRun(sql, bind, currentTxToken ?? undefined)
  }
  const legacyDb = await legacy()
  await legacyDb.run(sql, bind)
  const rows = await legacyDb.query(
    "SELECT last_insert_rowid() AS id, changes() AS changed"
  )
  return {
    lastInsertRowid: Number(rows[0]?.id ?? 0),
    changes: Number(rows[0]?.changed ?? 0)
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const initSQLite = async (): Promise<void> => {
  if (await isOpfs()) {
    await rpcPing()
    return
  }
  await (await legacy()).initSQLite()
}

/**
 * Force-flush pending writes. On the OPFS backend every committed statement
 * is already durable, so this is a no-op kept for the callers that flush at
 * unload/migration boundaries; on the legacy backend it persists the blob.
 */
export const flushSave = async (): Promise<void> => {
  if (await isOpfs()) return
  await (await legacy()).flushSave()
}

export const saveDatabase = flushSave

export const exportDatabaseBytes = async (): Promise<Uint8Array> => {
  if (await isOpfs()) return rpcExportDb()
  return (await legacy()).exportDatabaseBytes()
}

export const exportPersistedDatabaseBytes = async (): Promise<Uint8Array> => {
  if (await isOpfs()) return rpcExportDb()
  return (await legacy()).exportPersistedDatabaseBytes()
}

export const importDatabaseBytes = async (bytes: Uint8Array): Promise<void> => {
  if (await isOpfs()) {
    const counts = await rpcImportDb(bytes)
    logger.info(
      `Backup imported into OPFS backend: ${counts.sessions} sessions, ${counts.messages} messages`,
      "SQLite"
    )
    return
  }
  await (await legacy()).importDatabaseBytes(bytes)
}

export const resetSQLiteDatabase = async (): Promise<void> => {
  if (await isOpfs()) {
    await rpcReset()
    // A user-initiated reset must also remove the legacy rollback blob —
    // keeping it would resurrect deleted chats on a backend rollback.
    try {
      await (await legacy()).resetSQLiteDatabase()
    } catch (error) {
      logger.warn("Failed to clear legacy blob during reset", "SQLite", {
        error
      })
    }
    return
  }
  await (await legacy()).resetSQLiteDatabase()
}

/**
 * Raw legacy database handle. Exists for the durability test suite, which
 * tampers with schema state directly; production code must use query/run.
 * Unavailable on the OPFS backend — no context but the owner worker ever
 * holds the database handle there.
 */
export const getDb = async () => {
  if (await isOpfs()) {
    throw new Error("getDb is unavailable on the OPFS persistence backend")
  }
  return (await legacy()).getDb()
}
