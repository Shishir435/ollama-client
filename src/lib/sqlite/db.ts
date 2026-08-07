import { logger } from "@/lib/logger"
import {
  rpcExportDb,
  rpcFlush,
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

// Chat-history database facade. Every operation goes to the single database
// owner over persistence RPC — the Chromium offscreen document or the Firefox
// MV2 background page, which hosts the only chat-db worker.
//
// The owner serves one of two backends, and this module does not care which:
//
//   "opfs"   — the production topology, one sqlite-wasm database behind
//              opfs-sahpool. Durability is per-transaction.
//   "legacy" — the historical blob in WASM memory, persisted to IndexedDB as
//              one image, for a profile whose migration has not completed.
//
// Until 0.13.x this module dispatched on the backend marker and, for "legacy",
// opened a database *in the calling context* on a second SQLite build. That is
// what made a stale-writer guard necessary — every page was a writer — and it
// is why the extension shipped two engines. Both are gone: one owner, one
// engine, and clients that hold no database handle at all.

type SqlValue = string | number | null | Uint8Array
type QueryResult = Record<string, SqlValue>

export interface SqlExecutor {
  query: (sql: string, bind?: SqlValue[]) => Promise<QueryResult[]>
  run: (sql: string, bind?: SqlValue[]) => Promise<void>
  runWithMeta: (sql: string, bind?: SqlValue[]) => Promise<RunResult>
}

// ---------------------------------------------------------------------------
// Transaction scope. Every public statement and transaction acquires this
// context-local mutex. Transaction callbacks receive a scoped executor that
// bypasses the mutex and carries the owner's lease token.
//
// Do not represent async transaction ownership with a process-global token:
// unrelated work can run while a callback is awaiting and would accidentally
// inherit that token. Explicit executors keep those operations outside the
// transaction; the mutex parks them until commit/rollback.
// ---------------------------------------------------------------------------

let dbMutex: Promise<void> = Promise.resolve()

const withDbLock = async <T>(work: () => Promise<T>): Promise<T> => {
  const previous = dbMutex
  let release: () => void = () => {}
  dbMutex = new Promise((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await work()
  } finally {
    release()
  }
}

const executor = (token?: string): SqlExecutor => ({
  query: async (sql, bind = []) =>
    (await rpcQuery(sql, bind, token)) as QueryResult[],
  run: async (sql, bind = []) => {
    await rpcRun(sql, bind, token)
  },
  runWithMeta: (sql, bind = []) => rpcRun(sql, bind, token)
})

export const withTransaction = async (
  work: (transaction: SqlExecutor) => Promise<void>
): Promise<void> =>
  withDbLock(async () => {
    const token = crypto.randomUUID()
    const transaction = executor(token)
    await rpcTxBegin(token)
    try {
      await work(transaction)
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
  })

// ---------------------------------------------------------------------------
// Core statement API
// ---------------------------------------------------------------------------

export const query = async (
  sql: string,
  bind: SqlValue[] = []
): Promise<QueryResult[]> => withDbLock(() => executor().query(sql, bind))

export const run = async (sql: string, bind: SqlValue[] = []): Promise<void> =>
  withDbLock(() => executor().run(sql, bind))

/**
 * Run a mutating statement and atomically report its lastInsertRowid and
 * change count. On a shared connection this is the only race-free way to read
 * last_insert_rowid(): the owner answers both from inside the same op.
 */
export const runWithMeta = async (
  sql: string,
  bind: SqlValue[] = []
): Promise<RunResult> => withDbLock(() => executor().runWithMeta(sql, bind))

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const initSQLite = async (): Promise<void> => {
  await rpcPing()
}

/**
 * Force-flush pending writes. On the OPFS backend every committed statement is
 * already durable and the owner no-ops this; on the legacy blob it writes the
 * image. Kept for the callers that flush at unload, migration and export
 * boundaries.
 */
export const flushSave = async (): Promise<void> => {
  await rpcFlush()
}

export const saveDatabase = flushSave

export const exportDatabaseBytes = async (): Promise<Uint8Array> =>
  rpcExportDb()

/**
 * Historically this read the durable copy rather than a live context's
 * in-memory one, because any page could hold a different database. With a
 * single owner there is only one copy to export.
 */
export const exportPersistedDatabaseBytes = async (): Promise<Uint8Array> => {
  await flushSave()
  return rpcExportDb()
}

export const importDatabaseBytes = async (bytes: Uint8Array): Promise<void> => {
  const counts = await rpcImportDb(bytes)
  logger.info(
    `Backup imported: ${counts.sessions} sessions, ${counts.messages} messages`,
    "SQLite"
  )
}

export const resetSQLiteDatabase = async (): Promise<void> => {
  await rpcReset()
}
