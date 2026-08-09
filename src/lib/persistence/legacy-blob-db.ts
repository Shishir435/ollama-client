import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm"
import { SQLITE_DB_KEY, SQLITE_DB_NAME, SQLITE_DB_STORE } from "@/lib/constants"
import { asMigrationDatabase } from "@/lib/sqlite/migrations/database"
import {
  LATEST_SCHEMA_VERSION,
  repairSchemaDrift,
  runMigrations,
  setSchemaVersion
} from "@/lib/sqlite/migrations/migration-runner"
import { SCHEMA_SQL } from "@/lib/sqlite/schema"
import {
  type IntegrityReport,
  isSoundDatabase,
  readIntegrityReport
} from "./durable-tables"
import { readLegacyBlobBytes } from "./legacy-blob-reader"

/**
 * The legacy blob backend: the whole database in WASM memory, persisted as one
 * IndexedDB value. Serves profiles whose migration to OPFS has not completed,
 * and profiles pinned to the blob by the operator override.
 *
 * It runs inside the chat-db worker, alongside the OPFS backend and on the same
 * engine. Two things follow from that, and both are the point:
 *
 *   - The extension ships one SQLite. This was sql.js until 0.13.x, in every
 *     context that touched history. Official sqlite-wasm reads the same file
 *     format, but its JS glue is an order of magnitude larger than sql.js's
 *     (578KB against 46KB) and pulls an emitted worker asset with it, so an
 *     in-page swap put ~1.4MB into the background bundle. In the worker the
 *     glue is already paid for.
 *   - There is exactly one writer. The per-context database this replaces
 *     needed an import-generation guard and a backend re-read before every save
 *     to keep a stale page from overwriting a newer image. A single owner
 *     cannot have a stale writer, so neither guard has anything left to defend.
 *
 * Durability keeps the old shape deliberately: a debounced full-image export,
 * not per-transaction writes. The IndexedDB blob stays the system of record and
 * the rollback artifact for a profile on this backend, and a file that is being
 * preserved as evidence should be written in whole images, the way it was
 * written before.
 */

const SAVE_DEBOUNCE_MS = 1000

export interface LegacyBlobDb {
  /** The live handle. Statements run against it exactly as on the OPFS path. */
  readonly db: Database
  /**
   * Why this profile refuses writes, or null. Set when the image failed
   * `integrity_check`: such a database keeps its reads and its backup export
   * and loses nothing else, because the alternative is a serving path that
   * looks healthy while editing a file that is already broken.
   */
  readonly readOnlyReason: string | null
  /** Record a mutation. Schedules the debounced save unless a save is barred. */
  markDirty: () => void
  /** Force the debounced save to happen now. */
  flush: () => Promise<void>
  /** The current image, as a backup or an export would see it. */
  exportImage: () => Uint8Array
  close: () => void
}

/**
 * Every helper closes the connection it opens. A lingering handle makes
 * `deleteDatabase` fire `onblocked` and the reset path then waits on a delete
 * that never lands.
 */
const withBlobStore = <T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, done: (value: T) => void) => void
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
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
        const transaction = database.transaction([SQLITE_DB_STORE], mode)
        work(transaction.objectStore(SQLITE_DB_STORE), (value) => {
          database.close()
          resolve(value)
        })
        transaction.onerror = () => {
          database.close()
          reject(transaction.error)
        }
      } catch (error) {
        database.close()
        reject(error)
      }
    }
  })

/** Re-exported so a caller needs one module for the blob, not two. The reader
 * itself stays engine-free in `legacy-blob-reader.ts`, which is what lets the
 * host load it during migration without pulling the schema and the migration
 * runner into that chunk. */
export { readLegacyBlobBytes as readLegacyBlob } from "./legacy-blob-reader"

export const writeLegacyBlob = (bytes: Uint8Array): Promise<void> =>
  withBlobStore<void>("readwrite", (store, done) => {
    store.put(bytes, SQLITE_DB_KEY).onsuccess = () => done(undefined)
  })

export const deleteLegacyBlob = (): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SQLITE_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    // Another context still holds a handle; the delete completes once it
    // closes. Resolving optimistically matches what the caller can act on.
    request.onblocked = () => resolve()
  })

/**
 * The WASM glue admits a buffer only by `instanceof Uint8Array`, which is a
 * per-realm test. A structured clone read back out of IndexedDB can carry a
 * view constructed in another realm — it walks and quacks like a Uint8Array and
 * still fails that check, with "Value is not of a supported TypedArray type".
 * The copy happens only when the cheap check says it is needed: on a large blob
 * that is the difference between one image in memory and two.
 */
const sameRealmBytes = (bytes: Uint8Array): Uint8Array => {
  if (bytes instanceof Uint8Array) return bytes
  const foreign = bytes as ArrayLike<number>
  const copy = new Uint8Array(foreign.length)
  copy.set(foreign)
  return copy
}

/**
 * Open an in-memory database over an existing file image.
 *
 * RESIZEABLE is required, not optional: without it the deserialized database
 * cannot grow past the bytes it was handed, and the first row that does not fit
 * an existing page fails with SQLITE_FULL. FREEONCLOSE hands the buffer's
 * lifetime to SQLite, which is what makes `close()` sufficient cleanup.
 */
const deserialize = (sqlite3: Sqlite3Static, bytes: Uint8Array): Database => {
  const database = new sqlite3.oo1.DB(":memory:")
  const pointer = sqlite3.wasm.allocFromTypedArray(sameRealmBytes(bytes))
  try {
    database.checkRc(
      sqlite3.capi.sqlite3_deserialize(
        database.pointer as number,
        "main",
        pointer,
        bytes.byteLength,
        bytes.byteLength,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
          sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
      )
    )
  } catch (error) {
    // Closing releases the buffer under FREEONCLOSE. Deliberately no explicit
    // dealloc: whether ownership transferred before the failure is not
    // observable from here, and leaking one buffer on a fatal open beats
    // freeing one SQLite still owns.
    database.close()
    throw error
  }
  return database
}

const execRows = (database: Database, sql: string): unknown[][] =>
  database.exec({
    sql,
    returnValue: "resultRows",
    rowMode: "array"
  }) as unknown as unknown[][]

/**
 * A file damaged badly enough makes the pragma itself fail with SQLITE_CORRUPT
 * rather than report rows. Letting that propagate would abort the open, and an
 * open that aborts takes the read-only escape hatch down with it — this is the
 * case that needs the hatch most.
 */
const measureIntegrity = (database: Database): IntegrityReport => {
  try {
    return readIntegrityReport((sql) => execRows(database, sql))
  } catch (error) {
    return {
      integrityCheck:
        error instanceof Error
          ? error.message
          : `integrity_check failed: ${String(error)}`,
      foreignKeyViolations: 0
    }
  }
}

export interface OpenLegacyBlobOptions {
  /**
   * The verdict the migration already reached for this same image. Supplied so
   * a profile whose migration just surveyed the blob does not pay for a second
   * full scan on the same boot; absent for the operator-override path, which
   * skips the migration entirely and therefore has nothing to reuse.
   */
  knownIntegrity?: IntegrityReport
  onWarning?: (message: string, detail?: Record<string, unknown>) => void
}

export const openLegacyBlobDb = async (
  sqlite3: Sqlite3Static,
  options: OpenLegacyBlobOptions = {}
): Promise<LegacyBlobDb> => {
  const warn = options.onWarning ?? (() => {})
  const stored = await readLegacyBlobBytes()
  const loaded = stored !== null && stored.byteLength > 0

  const database = loaded
    ? deserialize(sqlite3, stored)
    : new sqlite3.oo1.DB(":memory:")
  const migrationDb = asMigrationDatabase(database)

  let readOnlyReason: string | null = null

  if (loaded) {
    const integrity = options.knownIntegrity ?? measureIntegrity(database)
    if (!isSoundDatabase(integrity)) {
      readOnlyReason = integrity.integrityCheck
      warn("Legacy chat database failed integrity_check; serving read-only", {
        integrityCheck: integrity.integrityCheck
      })
    }
  }

  const exportImage = (): Uint8Array =>
    sqlite3.capi.sqlite3_js_db_export(database.pointer as number)

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let saveInFlight: Promise<void> = Promise.resolve()
  let closed = false

  const persistNow = async (): Promise<void> => {
    if (closed || readOnlyReason) return
    const pending = saveInFlight.then(async () => {
      if (closed) return
      await writeLegacyBlob(exportImage())
    })
    // Keep the serialization chain alive even if this write rejects. Otherwise
    // one transient IndexedDB failure leaves the chain permanently rejected and
    // every later save silently chains onto it without running.
    saveInFlight = pending.catch(() => {})
    await pending
  }

  const cancelPendingSave = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  if (!loaded) {
    // SCHEMA_SQL is the latest schema, so stamp the new database at the latest
    // version and skip the migration runner below.
    database.exec(SCHEMA_SQL)
    setSchemaVersion(migrationDb, LATEST_SCHEMA_VERSION)
    await writeLegacyBlob(exportImage())
  }

  database.exec("PRAGMA foreign_keys=ON")

  if (!readOnlyReason && loaded) {
    // Version-gated forward migrations plus drift repair. Both write, which is
    // why they are gated on the integrity verdict: writing into a damaged
    // database turns a file a recovery tool could still read into one it
    // cannot.
    const applied = runMigrations(migrationDb)
    const repaired = repairSchemaDrift(migrationDb)
    if (applied > 0 || repaired > 0) {
      await writeLegacyBlob(exportImage())
    }
  }

  return {
    db: database,
    get readOnlyReason() {
      return readOnlyReason
    },
    markDirty() {
      if (readOnlyReason || closed) return
      cancelPendingSave()
      saveTimer = setTimeout(() => {
        saveTimer = null
        void persistNow().catch((error: unknown) => {
          warn("Failed to auto-save the legacy blob", { error: String(error) })
        })
      }, SAVE_DEBOUNCE_MS)
    },
    async flush() {
      cancelPendingSave()
      await persistNow()
    },
    exportImage,
    close() {
      closed = true
      cancelPendingSave()
      try {
        database.close()
      } catch {
        // Already closed, or closed underneath us; nothing left to release.
      }
    }
  }
}
