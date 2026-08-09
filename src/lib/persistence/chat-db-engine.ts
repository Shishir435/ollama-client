import sqlite3InitModule, {
  type Database,
  type SAHPoolUtil,
  type Sqlite3Static
} from "@sqlite.org/sqlite-wasm"
import { asMigrationDatabase } from "@/lib/sqlite/migrations/database"
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
import {
  deleteLegacyBlob,
  type LegacyBlobDb,
  openLegacyBlobDb,
  writeLegacyBlob
} from "./legacy-blob-db"
import type {
  CountsResult,
  ImportResult,
  PersistenceBackendMode,
  PersistenceOp,
  QueryRow,
  RunResult,
  SqlValue,
  SurveyResult
} from "./protocol"
import { PersistenceOpSchema } from "./protocol"

/**
 * The chat-history database engine. One instance exists per browser session,
 * inside the worker the persistence host owns
 * (src/lib/persistence/chat-db-worker.ts) — this module is the engine itself,
 * split out so it can be driven in-process by tests, where no Worker and no
 * OPFS exist.
 *
 * Two backends, one engine, one writer:
 *
 *   "opfs"   — production. One database behind the opfs-sahpool VFS. All writes
 *              are incremental page writes; no full-database export on any hot
 *              path.
 *   "legacy" — the historical blob, in WASM memory and persisted to IndexedDB
 *              as one image (see legacy-blob-db.ts). Only reached by a profile
 *              whose migration has not completed, or one pinned there by the
 *              operator override.
 *
 * Concurrency model: ops execute strictly serially. A transaction lease
 * (txBegin/txCommit/txRollback with a client token) parks every op that does
 * not carry the active token, so one client's multi-statement transaction can
 * never interleave with another client's statements. Within one op the engine
 * is atomic, which is what makes run's lastInsertRowid race-free.
 */

const DB_PATH = "/chat-history.sqlite"
/**
 * Scratch path an incoming database is verified in before it is allowed to
 * replace DB_PATH. Never opened by anything but the verification probe.
 */
const PROBE_PATH = "/chat-history-import-probe.sqlite"

const TX_LEASE_TIMEOUT_MS = 15_000

type Context =
  | { backend: "opfs"; db: Database; pool: SAHPoolUtil }
  | { backend: "legacy"; db: Database; legacy: LegacyBlobDb }

export interface ChatDbEngineOptions {
  /** The sqlite3.wasm bytes. A promise so the engine can be created before the
   * host has finished fetching them. */
  wasmBinary: Promise<ArrayBuffer>
  onError?: (message: string) => void
}

export interface ChatDbEngine {
  /** Run one op. Serialization and the transaction lease are handled inside. */
  submit: (request: unknown) => Promise<unknown>
}

export const createChatDbEngine = (
  options: ChatDbEngineOptions
): ChatDbEngine => {
  const reportError = options.onError ?? (() => {})

  let sqlite3Promise: Promise<Sqlite3Static> | null = null
  let poolPromise: Promise<SAHPoolUtil> | null = null
  let contextPromise: Promise<Context> | null = null
  let backend: PersistenceBackendMode = "opfs"
  // What the migration already learned about this same image, so the legacy
  // open does not repeat a full integrity scan on the same boot.
  let legacyIntegrityHint: IntegrityReport | undefined

  let activeTx: string | null = null
  let txLeaseTimer: ReturnType<typeof setTimeout> | null = null
  // A legacy-backed transaction defers its save until commit, the same way the
  // per-statement path defers behind the debounce.
  let legacyDirtyInTx = false

  const loadSqlite3 = (): Promise<Sqlite3Static> => {
    if (!sqlite3Promise) {
      sqlite3Promise = (async () => {
        const wasmBinary = await options.wasmBinary
        // The published typings declare init() without arguments, but the
        // runtime accepts an Emscripten config; wasmBinary avoids any fetch
        // inside the worker (bundler ?url assets inline as data: URLs in MV2
        // iife output, which Firefox's fetch rejects).
        return (
          sqlite3InitModule as unknown as (config: {
            wasmBinary: ArrayBuffer
            print: (message: string) => void
            printErr: (message: string) => void
          }) => Promise<Sqlite3Static>
        )({
          wasmBinary,
          print: () => {},
          printErr: (message: string) => reportError(message)
        })
      })()
    }
    return sqlite3Promise
  }

  /**
   * The OPFS pool, opened on demand.
   *
   * Lazy on purpose: a profile serving from the legacy blob has no OPFS
   * database and should not have a pool of preallocated files installed on its
   * behalf. The pool is still needed there for one thing — the import probe —
   * and that is a user-initiated restore, not a boot cost.
   */
  const getPool = (): Promise<SAHPoolUtil> => {
    if (!poolPromise) {
      const attempt = (async () => {
        const sqlite3 = await loadSqlite3()
        return sqlite3.installOpfsSAHPoolVfs({
          name: "chat-history-pool",
          initialCapacity: 6
        })
      })().catch((error: unknown) => {
        if (poolPromise === attempt) poolPromise = null
        throw error
      })
      poolPromise = attempt
    }
    return poolPromise
  }

  // A rejected context must never stay cached: the next op (including a
  // migration retry) has to re-attempt the open instead of replaying the
  // original failure until the engine is recreated.
  const selfClearing = (promise: Promise<Context>): Promise<Context> => {
    const tracked = promise.catch((error: unknown) => {
      if (contextPromise === tracked) contextPromise = null
      throw error
    })
    return tracked
  }

  const openOpfsContext = async (): Promise<Context> => {
    const pool = await getPool()
    // Before anything opens the database: a rollback copy left behind by a
    // replacement that never finished has to win over the half-written file it
    // was protecting.
    //
    // A failure here is not survivable by opening the database anyway. The copy
    // stays on disk, so a later boot will restore it — everything read in
    // between would be incomplete history, and everything written would be
    // discarded. So the open fails instead. The cached context is cleared on
    // rejection, so the next request retries the recovery, and making room
    // first handles the one transient cause worth retrying in-line: a pool with
    // no free slot.
    try {
      await ensureFreeSlots(pool, 1)
      await recoverInterruptedImport(pool, DB_PATH)
    } catch (error) {
      throw new Error(
        `Cannot restore the chat database after an interrupted replacement: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      )
    }
    const db = new pool.OpfsSAHPoolDb(DB_PATH)
    initializeSchema(db)
    return { backend: "opfs", db, pool }
  }

  const openLegacyContext = async (): Promise<Context> => {
    const sqlite3 = await loadSqlite3()
    const legacy = await openLegacyBlobDb(sqlite3, {
      knownIntegrity: legacyIntegrityHint,
      onWarning: (message, detail) =>
        reportError(detail ? `${message} ${JSON.stringify(detail)}` : message)
    })
    return { backend: "legacy", db: legacy.db, legacy }
  }

  const openContext = (): Promise<Context> => {
    if (!contextPromise) {
      contextPromise = selfClearing(
        backend === "legacy" ? openLegacyContext() : openOpfsContext()
      )
    }
    return contextPromise
  }

  const reopenOpfsContext = (pool: SAHPoolUtil): Promise<Context> => {
    contextPromise = selfClearing(
      (async () => {
        const reopened = new pool.OpfsSAHPoolDb(DB_PATH)
        initializeSchema(reopened)
        return { backend: "opfs" as const, db: reopened, pool }
      })()
    )
    return contextPromise
  }

  const closeContext = async (): Promise<void> => {
    const current = contextPromise
    contextPromise = null
    if (!current) return
    const context = await current.catch(() => null)
    if (!context) return
    if (context.backend === "legacy") {
      context.legacy.close()
      return
    }
    context.db.close()
  }

  // -------------------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------------------

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
    const compat = asMigrationDatabase(db)
    const hasSessions =
      queryNumber(
        db,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sessions'"
      ) > 0
    // Every statement in SCHEMA_SQL is IF NOT EXISTS, so it runs on every open:
    // on a fresh database it creates everything, and on an existing one it fills
    // in whatever is absent.
    //
    // It used to run only when `sessions` was missing, which meant a table added
    // to the schema without a paired migration never reached a profile that
    // already had `sessions`. chunk_feedback arrived that way in 0.10.0, so
    // profiles created on 0.6.0-0.9.x have been missing it since — the drift
    // repair below only knows about tool_loop_runs and prompt_templates.
    //
    // The version stamp stays gated: only a database that did not exist a moment
    // ago is at the latest schema by construction. Stamping an old one would skip
    // the forward migrations it still needs.
    db.exec(SCHEMA_SQL)
    if (!hasSessions) {
      setSchemaVersion(compat, LATEST_SCHEMA_VERSION)
    }
    db.exec("PRAGMA foreign_keys=ON")
    // Version-gated forward migrations plus drift repair.
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

  /** An import needs room for the verification probe and the rollback copy
   * beside the live database. The pool does not grow on its own. */
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
   * Any failure here — a truncated file, a payload that is not a database at
   * all, no room in the pool — leaves the live database untouched, which is the
   * whole point of doing this before the replacement rather than after.
   */
  const verifyImportCandidate = async (
    pool: SAHPoolUtil,
    bytes: ArrayBuffer
  ): Promise<IntegrityReport> => {
    pool.unlink(PROBE_PATH)
    await ensureFreeSlots(pool, 1)
    // Owns the scratch file's whole lifetime, including the failure paths. The
    // caller's cleanup ran only after the rollback copy was staged, so a payload
    // that imported but would not open left the scratch file linked and holding
    // one of the pool's fixed slots.
    try {
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
    } finally {
      pool.unlink(PROBE_PATH)
    }
  }

  /**
   * The legacy equivalent, in memory.
   *
   * A profile on the blob has no OPFS database, and installing a pool of
   * preallocated files to inspect a payload it may reject would be a large side
   * effect for a read. Deserializing the candidate gives the same guarantee —
   * nothing is replaced until the incoming file is known to be sound — on the
   * same engine.
   */
  const verifyLegacyCandidate = async (
    bytes: ArrayBuffer
  ): Promise<IntegrityReport> => {
    const sqlite3 = await loadSqlite3()
    const probe = new sqlite3.oo1.DB(":memory:")
    const pointer = sqlite3.wasm.allocFromTypedArray(new Uint8Array(bytes))
    try {
      probe.checkRc(
        sqlite3.capi.sqlite3_deserialize(
          probe.pointer as number,
          "main",
          pointer,
          bytes.byteLength,
          bytes.byteLength,
          sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
        )
      )
      return integrity(probe)
    } catch (error) {
      // A payload that is not a database at all fails at the open or at the
      // pragma with SQLITE_NOTADB rather than reporting rows. That is a verdict,
      // not an exception to propagate: reported as one, the caller rejects the
      // restore the same way it rejects a corrupt-but-readable file, and the
      // live database is equally untouched either way.
      return {
        integrityCheck:
          error instanceof Error
            ? error.message
            : `integrity_check failed: ${String(error)}`,
        foreignKeyViolations: 0
      }
    } finally {
      probe.close()
    }
  }

  // -------------------------------------------------------------------------
  // Transaction lease
  // -------------------------------------------------------------------------

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
      reportError("transaction lease expired; rolling back")
      try {
        db.exec("ROLLBACK")
      } catch {
        // no open transaction left to roll back
      }
      legacyDirtyInTx = false
      clearTxLease()
      void pump()
    }, TX_LEASE_TIMEOUT_MS)
  }

  /**
   * Every write path funnels through here. A profile whose file is damaged
   * keeps its reads, its backup export and its diagnostics; what it loses is
   * the ability to write, because the alternative is a serving path that looks
   * healthy while it edits a file that is already broken.
   */
  const assertWritable = (context: Context): void => {
    if (context.backend !== "legacy") return
    const reason = context.legacy.readOnlyReason
    if (!reason) return
    throw new Error(
      `Chat history is read-only: the stored database failed integrity_check (${reason}). Export a backup and reset the database to continue.`
    )
  }

  // -------------------------------------------------------------------------
  // Ops
  // -------------------------------------------------------------------------

  const execute = async (request: PersistenceOp): Promise<unknown> => {
    if (request.op === "setBackend") {
      if (backend !== request.backend) {
        await closeContext()
        backend = request.backend
      }
      legacyIntegrityHint = request.integrity
      await openContext()
      return null
    }

    const context = await openContext()
    const { db } = context

    switch (request.op) {
      case "ping":
        return { ok: true }
      case "query":
        return runQuery(db, request.sql, request.bind)
      case "run": {
        assertWritable(context)
        const result = runStatement(db, request.sql, request.bind)
        if (context.backend === "legacy") {
          if (activeTx) legacyDirtyInTx = true
          else context.legacy.markDirty()
        }
        return result
      }
      case "txBegin": {
        assertWritable(context)
        db.exec("BEGIN IMMEDIATE")
        legacyDirtyInTx = false
        startTxLease(request.token, db)
        return null
      }
      case "txCommit": {
        try {
          db.exec("COMMIT")
          if (context.backend === "legacy" && legacyDirtyInTx) {
            context.legacy.markDirty()
          }
        } finally {
          legacyDirtyInTx = false
          clearTxLease()
        }
        return null
      }
      case "txRollback": {
        try {
          db.exec("ROLLBACK")
        } finally {
          // The rolled-back writes are gone, so a later commit must not
          // schedule a save for them.
          legacyDirtyInTx = false
          clearTxLease()
        }
        return null
      }
      case "counts":
        return counts(db)
      case "flush": {
        // On OPFS every committed statement is already durable, so this exists
        // for the legacy blob alone — the callers that flush at unload,
        // migration and export boundaries do not know which backend answered.
        if (context.backend === "legacy") await context.legacy.flush()
        return null
      }
      case "exportDb": {
        if (context.backend === "legacy") {
          const image = context.legacy.exportImage()
          return image.buffer.slice(
            image.byteOffset,
            image.byteOffset + image.byteLength
          )
        }
        const bytes = await context.pool.exportFile(DB_PATH)
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        )
      }
      case "surveyDb": {
        // Read-only measurement of a candidate database, on the same engine that
        // will import it. The live database is not touched and the scratch file is
        // unlinked before returning, so a survey that throws leaves nothing behind
        // for the next one to trip over.
        const pool = await getPool()
        pool.unlink(PROBE_PATH)
        await ensureFreeSlots(pool, 1)
        // The unlink covers the import and the open, not just the survey: a blob
        // that imports but cannot be opened would otherwise keep the scratch file
        // linked and hold a pool slot until some later op happened to clear it.
        // The pool has a fixed capacity, so a leaked slot is a resource the next
        // import has to grow the pool to replace.
        try {
          await pool.importDb(PROBE_PATH, new Uint8Array(request.bytes))
          const source = new pool.OpfsSAHPoolDb(PROBE_PATH)
          try {
            // Nothing writes to this handle — no schema runner, no migrations. A
            // source blob is evidence, and evidence that has been written to is
            // no longer the thing that was measured.
            return {
              ...counts(source),
              schemaVersion: queryNumber(source, "PRAGMA user_version"),
              integrity: integrity(source)
            } satisfies SurveyResult
          } finally {
            source.close()
          }
        } finally {
          pool.unlink(PROBE_PATH)
        }
      }
      case "importDb": {
        // Backup restore and legacy migration: replace the database wholesale.
        //
        // The payload is verified FIRST, away from the live database. Verifying
        // after replacing it cost the user their history whenever the payload
        // turned out to be unusable: a rejected restore reported failure over an
        // already-destroyed database. Nothing touches the live file until the
        // incoming one is known to be sound.
        if (context.backend === "legacy") {
          const report = await verifyLegacyCandidate(request.bytes)
          if (!isSoundDatabase(report)) {
            throw new Error(
              `Imported database failed integrity_check: ${report.integrityCheck}`
            )
          }
          // The blob is the system of record here, so it is written first and
          // the database is reopened from it. There is no half-replaced state
          // to recover from: either the new image is in IndexedDB or the old
          // one still is.
          await writeLegacyBlob(new Uint8Array(request.bytes))
          await closeContext()
          legacyIntegrityHint = report
          const fresh = await openContext()
          return {
            ...counts(fresh.db),
            integrity: report
          } satisfies ImportResult
        }

        const pool = context.pool
        // The scratch file is gone by the time this returns, whichever way it
        // went — verifyImportCandidate owns it end to end.
        const report = await verifyImportCandidate(pool, request.bytes)
        if (!isSoundDatabase(report)) {
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
          const fresh = await reopenOpfsContext(pool)
          const result: ImportResult = {
            ...counts(fresh.db),
            integrity: report
          }
          clearRollbackCopy(pool)
          return result
        } catch (error) {
          // Reopening is not unconditional. While a rollback copy is still on
          // disk it outranks the half-replaced file — startup recovery restores
          // it — so opening that file here would serve missing history and let
          // writes land on a database the next boot discards. When the copy
          // cannot be put back, the engine opens nothing: the next request
          // re-enters openContext, which recovers before anything opens.
          if (await recoverFailedReplacement(pool, DB_PATH, rollback)) {
            await reopenOpfsContext(pool).catch((reopenError: unknown) => {
              reportError(`reopen after a failed import failed: ${reopenError}`)
            })
          }
          throw error
        }
      }
      case "reset": {
        if (context.backend === "legacy") {
          await closeContext()
          await deleteLegacyBlob()
          await openContext()
          return null
        }
        db.close()
        contextPromise = null
        context.pool.unlink(DB_PATH)
        // A user-initiated reset must also remove the legacy blob. It is the
        // rollback artifact, so keeping it would resurrect every deleted chat
        // the moment the operator override sent this profile back to it.
        await deleteLegacyBlob().catch((error: unknown) => {
          reportError(`failed to clear the legacy blob during reset: ${error}`)
        })
        await reopenOpfsContext(context.pool)
        return null
      }
      default:
        throw new Error(`Unknown persistence op: ${JSON.stringify(request)}`)
    }
  }

  // -------------------------------------------------------------------------
  // Serial scheduler
  //
  // Ops run one at a time. While a transaction lease is active, only ops
  // carrying its token are admitted; everything else waits in the queue in
  // arrival order. The lease has a hard timeout so a client that dies between
  // txBegin and txCommit (closed page) cannot starve every other client.
  // -------------------------------------------------------------------------

  interface QueueEntry {
    request: PersistenceOp
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
  }

  const queue: QueueEntry[] = []
  let pumping = false

  const tokenOf = (request: PersistenceOp): string | undefined =>
    "tx" in request && request.tx
      ? request.tx
      : "token" in request
        ? request.token
        : undefined

  const isAdmissible = (request: PersistenceOp): boolean =>
    activeTx === null || tokenOf(request) === activeTx

  const pump = async (): Promise<void> => {
    if (pumping) return
    pumping = true
    try {
      for (;;) {
        const index = queue.findIndex((entry) => isAdmissible(entry.request))
        if (index === -1) break
        const [entry] = queue.splice(index, 1)
        try {
          entry.resolve(await execute(entry.request))
        } catch (error) {
          entry.reject(error)
        }
      }
    } finally {
      pumping = false
    }
  }

  return {
    submit: (request) => {
      const parsed = PersistenceOpSchema.safeParse(request)
      if (!parsed.success) {
        return Promise.reject(new Error("Invalid persistence operation"))
      }
      return new Promise((resolve, reject) => {
        queue.push({ request: parsed.data, resolve, reject })
        void pump()
      })
    }
  }
}
