/// <reference lib="webworker" />
import sqlite3InitModule, {
  type Database,
  type SAHPoolUtil,
  type Sqlite3Static
} from "@sqlite.org/sqlite-wasm"
import {
  LATEST_SCHEMA_VERSION,
  repairSchemaDrift,
  runMigrations,
  setSchemaVersion
} from "@/lib/sqlite/migrations/migration-runner"
import { SCHEMA_SQL } from "@/lib/sqlite/schema"
import {
  countDurableTables,
  type DurableTable,
  type IntegrityReport,
  isSoundDatabase,
  readIntegrityReport,
  tableExistsSql
} from "./durable-tables"
import {
  clearRollbackCopy,
  recoverFailedReplacement,
  recoverInterruptedImport,
  stageRollbackCopy
} from "./import-rollback"
import type {
  CountsResult,
  ImportResult,
  PersistenceOp,
  QueryRow,
  RunResult,
  SqlValue
} from "./protocol"
import { asSqlJsDatabase } from "./sqljs-compat"

// The production chat-history database owner. Exactly one instance runs per
// browser session, hosted by the Chromium offscreen document or the Firefox
// MV2 background page. All writes are incremental page writes through the
// opfs-sahpool VFS — no full-database export exists on any hot path.
//
// Concurrency model: ops execute strictly serially. A transaction lease
// (txBegin/txCommit/txRollback with a client token) parks every op that does
// not carry the active token, so one client's multi-statement transaction can
// never interleave with another client's statements. Within one op the worker
// is atomic, which is what makes run's lastInsertRowid race-free.

const DB_PATH = "/chat-history.sqlite"
// Scratch path an incoming database is verified in before it is allowed to
// replace DB_PATH. Never opened by anything but the verification probe.
const PROBE_PATH = "/chat-history-import-probe.sqlite"

interface WorkerRequest {
  id: number
  request: PersistenceOp
}

interface InitMessage {
  init: true
  wasmBinary: ArrayBuffer
}

let resolveWasmBinary: (binary: ArrayBuffer) => void
const wasmBinaryReady = new Promise<ArrayBuffer>((resolve) => {
  resolveWasmBinary = resolve
})

let contextPromise: Promise<{ db: Database; pool: SAHPoolUtil }> | null = null

// A rejected context must never stay cached: the next op (including a
// migration retry) has to re-attempt the open instead of replaying the
// original failure until the worker is recreated.
const selfClearing = (
  promise: Promise<{ db: Database; pool: SAHPoolUtil }>
): Promise<{ db: Database; pool: SAHPoolUtil }> => {
  const tracked = promise.catch((error) => {
    if (contextPromise === tracked) contextPromise = null
    throw error
  })
  return tracked
}

const reopenContext = (
  pool: SAHPoolUtil
): NonNullable<typeof contextPromise> => {
  contextPromise = selfClearing(
    (async () => {
      const reopened = new pool.OpfsSAHPoolDb(DB_PATH)
      initializeSchema(reopened)
      return { db: reopened, pool }
    })()
  )
  return contextPromise
}

const openContext = (): NonNullable<typeof contextPromise> => {
  if (!contextPromise) {
    contextPromise = selfClearing(
      (async () => {
        const wasmBinary = await wasmBinaryReady
        // The published typings declare init() without arguments, but the
        // runtime accepts an Emscripten config; wasmBinary avoids any fetch
        // inside the worker (bundler ?url assets inline as data: URLs in MV2
        // iife output, which Firefox's fetch rejects).
        const sqlite3 = await (
          sqlite3InitModule as unknown as (config: {
            wasmBinary: ArrayBuffer
            print: (message: string) => void
            printErr: (message: string) => void
          }) => Promise<Sqlite3Static>
        )({
          wasmBinary,
          print: () => {},
          printErr: (message: string) => console.error("[chat-db]", message)
        })
        const pool = await sqlite3.installOpfsSAHPoolVfs({
          name: "chat-history-pool",
          initialCapacity: 6
        })
        // Before anything opens the database: a rollback copy left behind by a
        // replacement that never finished has to win over the half-written file
        // it was protecting.
        await recoverInterruptedImport(pool, DB_PATH).catch(
          (error: unknown) => {
            console.error("[chat-db] rollback recovery failed", error)
          }
        )
        const db = new pool.OpfsSAHPoolDb(DB_PATH)
        initializeSchema(db)
        return { db, pool }
      })()
    )
  }
  return contextPromise
}

const queryNumber = (db: Database, sql: string): number => {
  let value = 0
  db.exec({
    sql,
    callback: (row) => {
      value = Number((row as unknown[])[0])
    }
  })
  return value
}

const initializeSchema = (db: Database): void => {
  const compat = asSqlJsDatabase(db)
  const hasSessions =
    queryNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sessions'"
    ) > 0
  if (!hasSessions) {
    db.exec(SCHEMA_SQL)
    setSchemaVersion(compat, LATEST_SCHEMA_VERSION)
  }
  db.exec("PRAGMA foreign_keys=ON")
  // Version-gated forward migrations plus drift repair — the same runner the
  // sql.js path used, through the compat facade.
  runMigrations(compat)
  repairSchemaDrift(compat)
}

const runQuery = (db: Database, sql: string, bind?: SqlValue[]): QueryRow[] =>
  db.exec({
    sql,
    ...(bind && bind.length > 0 ? { bind: bind as never } : {}),
    returnValue: "resultRows",
    rowMode: "object"
  }) as unknown as QueryRow[]

const runStatement = (
  db: Database,
  sql: string,
  bind?: SqlValue[]
): RunResult => {
  db.exec({
    sql,
    ...(bind && bind.length > 0 ? { bind: bind as never } : {})
  })
  // Same op, same connection — atomic relative to every other client.
  return {
    lastInsertRowid: queryNumber(db, "SELECT last_insert_rowid()"),
    changes: queryNumber(db, "SELECT changes()")
  }
}

const tableExists = (db: Database, table: DurableTable): boolean =>
  queryNumber(db, tableExistsSql(table)) > 0

const counts = (db: Database): CountsResult => {
  const tables = countDurableTables(
    (sql) => queryNumber(db, sql),
    (table) => tableExists(db, table)
  )
  return {
    sessions: tables.sessions ?? 0,
    messages: tables.messages ?? 0,
    tables
  }
}

/** An import needs room for the verification probe and the rollback copy beside
 * the live database. The pool does not grow on its own. */
const ensureFreeSlots = async (
  pool: SAHPoolUtil,
  needed: number
): Promise<void> => {
  const free = pool.getCapacity() - pool.getFileCount()
  if (free >= needed) return
  await pool.addCapacity(needed - free + 1)
}

/**
 * Import a candidate database to the scratch path and report its integrity.
 *
 * Any failure here — a truncated file, a payload that is not a database at all,
 * no room in the pool — leaves the live database untouched, which is the whole
 * point of doing this before the replacement rather than after.
 */
const verifyImportCandidate = async (
  pool: SAHPoolUtil,
  bytes: ArrayBuffer
): Promise<IntegrityReport> => {
  pool.unlink(PROBE_PATH)
  await ensureFreeSlots(pool, 1)
  await pool.importDb(PROBE_PATH, new Uint8Array(bytes))
  const probe = new pool.OpfsSAHPoolDb(PROBE_PATH)
  try {
    // Read before any schema runner sees the file: migrations write, and
    // writing into a corrupt database turns a rejectable import into a
    // damaged one.
    return integrity(probe)
  } finally {
    probe.close()
  }
}

const integrity = (db: Database): IntegrityReport =>
  readIntegrityReport((sql) => {
    const rows: unknown[][] = []
    db.exec({
      sql,
      callback: (row) => {
        rows.push(row as unknown[])
      }
    })
    return rows
  })

// ---------------------------------------------------------------------------
// Transaction lease + serial scheduler
//
// Ops run one at a time. While a transaction lease is active, only ops
// carrying its token are admitted; everything else waits in the queue in
// arrival order. The lease has a hard timeout so a client that dies between
// txBegin and txCommit (closed page) cannot starve every other client — the
// worker rolls back and releases.
// ---------------------------------------------------------------------------

const TX_LEASE_TIMEOUT_MS = 15_000

let activeTx: string | null = null
let txLeaseTimer: ReturnType<typeof setTimeout> | null = null

const tokenOf = (request: PersistenceOp): string | undefined =>
  "tx" in request && request.tx
    ? request.tx
    : "token" in request
      ? request.token
      : undefined

const isAdmissible = (request: PersistenceOp): boolean =>
  activeTx === null || tokenOf(request) === activeTx

const clearTxLease = (): void => {
  activeTx = null
  if (txLeaseTimer) {
    clearTimeout(txLeaseTimer)
    txLeaseTimer = null
  }
}

const startTxLease = (token: string, db: Database): void => {
  activeTx = token
  txLeaseTimer = setTimeout(() => {
    console.error("[chat-db] transaction lease expired; rolling back")
    try {
      db.exec("ROLLBACK")
    } catch {
      // no open transaction left to roll back
    }
    clearTxLease()
    void pump()
  }, TX_LEASE_TIMEOUT_MS)
}

const execute = async (request: PersistenceOp): Promise<unknown> => {
  const { db, pool } = await openContext()

  switch (request.op) {
    case "ping":
      return { ok: true }
    case "query":
      return runQuery(db, request.sql, request.bind)
    case "run":
      return runStatement(db, request.sql, request.bind)
    case "txBegin": {
      db.exec("BEGIN IMMEDIATE")
      startTxLease(request.token, db)
      return null
    }
    case "txCommit": {
      try {
        db.exec("COMMIT")
      } finally {
        clearTxLease()
      }
      return null
    }
    case "txRollback": {
      try {
        db.exec("ROLLBACK")
      } finally {
        clearTxLease()
      }
      return null
    }
    case "counts":
      return counts(db)
    case "exportDb": {
      const bytes = await pool.exportFile(DB_PATH)
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      )
    }
    case "importDb": {
      // Backup restore and legacy migration: replace the database wholesale.
      //
      // The payload is imported to a scratch path and verified there FIRST.
      // Verifying after replacing the live file cost the user their history
      // whenever the payload turned out to be unusable: a rejected restore
      // reported failure over an already-destroyed database. Nothing touches
      // the live file until the incoming one is known to be sound.
      const report = await verifyImportCandidate(pool, request.bytes)
      if (!isSoundDatabase(report)) {
        pool.unlink(PROBE_PATH)
        throw new Error(
          `Imported database failed integrity_check: ${report.integrityCheck}`
        )
      }

      db.close()
      contextPromise = null
      // The replacement itself can still fail or be interrupted, so the live
      // database is copied aside until it completes. A replacement that cannot
      // be protected does not happen: failing here leaves the database intact
      // and the restore retryable.
      await ensureFreeSlots(pool, 1)
      const rollback = await stageRollbackCopy(pool, DB_PATH)
      try {
        await pool.importDb(DB_PATH, new Uint8Array(request.bytes))
        // Held until the imported database is open, migrated by the schema
        // runner, and counted. Reopening is where forward migrations and drift
        // repair happen, and they write — a failure there is exactly the kind
        // of restore that must still be undoable.
        const { db: fresh } = await reopenContext(pool)
        const result: ImportResult = { ...counts(fresh), integrity: report }
        clearRollbackCopy(pool)
        return result
      } catch (error) {
        // Reopening is not unconditional. While a rollback copy is still on
        // disk it outranks the half-replaced file — startup recovery restores
        // it — so opening that file here would serve missing history and let
        // writes land on a database the next boot discards. When the copy
        // cannot be put back, the worker opens nothing: the next request
        // re-enters openContext, which recovers before anything opens.
        if (await recoverFailedReplacement(pool, DB_PATH, rollback)) {
          await reopenContext(pool).catch((reopenError: unknown) => {
            console.error(
              "[chat-db] reopen after a failed import failed",
              reopenError
            )
          })
        }
        throw error
      } finally {
        pool.unlink(PROBE_PATH)
      }
    }
    case "reset": {
      db.close()
      contextPromise = null
      pool.unlink(DB_PATH)
      await reopenContext(pool)
      return null
    }
    default:
      throw new Error(`Unknown persistence op: ${JSON.stringify(request)}`)
  }
}

const respond = async (message: WorkerRequest): Promise<void> => {
  try {
    const result = await execute(message.request)
    if (result instanceof ArrayBuffer) {
      self.postMessage({ id: message.id, ok: true, result }, [result])
    } else {
      self.postMessage({ id: message.id, ok: true, result })
    }
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

const queue: WorkerRequest[] = []
let pumping = false

const pump = async (): Promise<void> => {
  if (pumping) return
  pumping = true
  try {
    for (;;) {
      const index = queue.findIndex((message) => isAdmissible(message.request))
      if (index === -1) break
      const [message] = queue.splice(index, 1)
      await respond(message)
    }
  } finally {
    pumping = false
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest | InitMessage>) => {
  if ("init" in event.data) {
    resolveWasmBinary(event.data.wasmBinary)
    return
  }
  queue.push(event.data)
  void pump()
}
