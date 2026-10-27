import { logger } from "@/lib/logger"

/** The two statements space reclaim needs, satisfied by the db facade. */
export interface ReclaimExecutor {
  query: (
    sql: string
  ) => Promise<Record<string, string | number | null | Uint8Array>[]>
  run: (sql: string) => Promise<unknown>
}

/** Smallest amount of free space worth a pass. */
const MIN_FREE_BYTES = 16 * 1024 * 1024
/** Share of the file that must be free before a pass runs. */
const MIN_FREE_SHARE = 0.2

export interface ReclaimResult {
  reclaimed: boolean
  freeBytesBefore: number
  fileBytesBefore: number
  fileBytesAfter: number
}

const pragma = async (
  executor: ReclaimExecutor,
  name: string
): Promise<number> => {
  const rows = await executor.query(`PRAGMA ${name}`)
  return Number((rows[0] ? Object.values(rows[0])[0] : 0) ?? 0)
}

/**
 * Returns deleted data's pages to the file system.
 *
 * SQLite keeps the pages of deleted rows on a free list and never shrinks the
 * file, so deleting a thousand sessions left the database, and every backup of
 * it, exactly as large as before. Only a rewrite releases them.
 *
 * `VACUUM` is the whole mechanism, and it is cheap because it copies only live
 * data: on the production OPFS backend 400 MB of live rows took 1.4 s and 80 MB
 * took 0.3 s. Incremental auto-vacuum was not an option — through persistence
 * RPC `PRAGMA incremental_vacuum(N)` releases one page per call, which took
 * 138 s to free 190 MB. Nothing runs unless a worthwhile share of the file is
 * free, so most startups cost three pragma reads.
 */
export const reclaimDatabaseSpace = async (
  executor: ReclaimExecutor,
  signal?: AbortSignal
): Promise<ReclaimResult> => {
  const pageSize = await pragma(executor, "page_size")
  const pageCount = await pragma(executor, "page_count")
  const freePages = await pragma(executor, "freelist_count")
  const freeBytes = freePages * pageSize
  const fileBytes = pageCount * pageSize
  if (freeBytes < MIN_FREE_BYTES || freeBytes < fileBytes * MIN_FREE_SHARE)
    return {
      reclaimed: false,
      freeBytesBefore: freeBytes,
      fileBytesBefore: fileBytes,
      fileBytesAfter: fileBytes
    }

  signal?.throwIfAborted()
  await executor.run("VACUUM")
  const fileBytesAfter = (await pragma(executor, "page_count")) * pageSize
  logger.info("Database compacted", "SpaceReclaim", {
    freeBytesBefore: freeBytes,
    fileBytesBefore: fileBytes,
    fileBytesAfter
  })
  return {
    reclaimed: true,
    freeBytesBefore: freeBytes,
    fileBytesBefore: fileBytes,
    fileBytesAfter
  }
}
