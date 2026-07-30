// Rollback for the one operation that replaces the whole chat database:
// backup restore and the legacy-blob migration both go through `importDb`.
//
// Verifying the incoming file first (see chat-db-worker) rules out a bad
// payload, but the physical replacement can still fail or be interrupted — the
// offscreen host can be evicted, the worker can die, the write can fail
// halfway. Without a retained copy the user is left with a half-written
// database and an error message.
//
// So the live database is copied aside first. The copy is deleted only after
// the replacement completes, which makes its presence at startup mean exactly
// one thing: a replacement began and never finished, and the pre-replacement
// database is the one to keep. Restoring is the conservative outcome — the user
// keeps the history they had and can retry the restore.

export const ROLLBACK_PATH = "/chat-history-rollback.sqlite"

/** The slice of the opfs-sahpool utility this needs. */
export interface RollbackPool {
  exportFile: (path: string) => Promise<Uint8Array>
  importDb: (path: string, bytes: Uint8Array) => unknown
  unlink: (path: string) => void
  getFileNames: () => string[]
}

const log = (message: string, detail?: unknown): void => {
  if (detail === undefined) {
    console.error(`[chat-db] ${message}`)
    return
  }
  console.error(`[chat-db] ${message}`, detail)
}

/**
 * Copy the live database aside before it is replaced.
 *
 * Returns the bytes so a failure in the same session can undo the replacement
 * without reading OPFS again, or null when there is nothing to protect — a
 * fresh profile has no database yet, and that is not an error.
 */
export const stageRollbackCopy = async (
  pool: RollbackPool,
  dbPath: string
): Promise<Uint8Array | null> => {
  pool.unlink(ROLLBACK_PATH)
  let bytes: Uint8Array
  try {
    bytes = await pool.exportFile(dbPath)
  } catch (error) {
    log("no live database to stage for rollback", error)
    return null
  }
  if (bytes.byteLength === 0) return null
  await pool.importDb(ROLLBACK_PATH, bytes)
  return bytes
}

/**
 * Put the pre-replacement database back and drop the copy.
 *
 * A failure here leaves the copy in place on purpose: startup recovery will
 * find it and try again, which is the only remaining chance to save the data.
 */
export const restoreRollbackCopy = async (
  pool: RollbackPool,
  dbPath: string,
  bytes: Uint8Array
): Promise<void> => {
  await pool.importDb(dbPath, bytes)
  pool.unlink(ROLLBACK_PATH)
}

/** Drop the copy after a replacement completed. */
export const clearRollbackCopy = (pool: RollbackPool): void => {
  pool.unlink(ROLLBACK_PATH)
}

/**
 * Startup recovery. A rollback copy that outlived its replacement means the
 * replacement never finished, so the copy is the database to keep.
 *
 * Returns whether anything was restored.
 */
export const recoverInterruptedImport = async (
  pool: RollbackPool,
  dbPath: string
): Promise<boolean> => {
  if (!pool.getFileNames().includes(ROLLBACK_PATH)) return false
  let bytes: Uint8Array
  try {
    bytes = await pool.exportFile(ROLLBACK_PATH)
  } catch (error) {
    // Unreadable copy: nothing to restore from, and keeping it would make every
    // future boot try again.
    log("rollback copy could not be read; discarding it", error)
    pool.unlink(ROLLBACK_PATH)
    return false
  }
  if (bytes.byteLength === 0) {
    pool.unlink(ROLLBACK_PATH)
    return false
  }
  await pool.importDb(dbPath, bytes)
  pool.unlink(ROLLBACK_PATH)
  log("restored the pre-import database after an interrupted replacement")
  return true
}
