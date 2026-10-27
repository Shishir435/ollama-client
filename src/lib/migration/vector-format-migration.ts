import { abortableDelay } from "@/lib/abortable-delay"
import { STORAGE_KEYS } from "@/lib/constants"
import { vectorDb } from "@/lib/embeddings/db"
import {
  encodeVectorDocument,
  isLegacyVectorRow
} from "@/lib/embeddings/vector-codec"
import {
  recordVectorStorageChange,
  applyVectorStorageDelta,
  emptyVectorStorageStats
} from "@/lib/embeddings/vector-storage-stats"
import { logger } from "@/lib/logger"
import {
  getPlasmoStoredValue,
  removePlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"

const BATCH_SIZE = 200
const DELAY_MS = 20
/** Batches between progress writes; a cut-short run also writes on the way out. */
const PROGRESS_EVERY_BATCHES = 10

/**
 * Forgets that the rewrite finished, so the next startup scans again.
 *
 * Replacing the vector database (a backup restore) can bring back rows in the
 * earlier shape, below any saved position and after the completion flag was
 * set. Without this they would never be rewritten.
 */
export const resetVectorFormatMigration = async (): Promise<void> => {
  await removePlasmoStoredValue(STORAGE_KEYS.EMBEDDINGS.VECTOR_FORMAT_MIGRATED)
  await removePlasmoStoredValue(STORAGE_KEYS.EMBEDDINGS.VECTOR_FORMAT_PROGRESS)
}

/**
 * Rewrites saved vectors from float64 `number[]` pairs to the float32 shape.
 *
 * Each batch is one transaction that re-reads its rows by id, so a vector
 * stored or replaced meanwhile is never overwritten with a stale copy, and the
 * storage totals change in the same commit as the rows. The pass is keyed on
 * row shape, so a worker lost mid-run is simply finished by the next run, which
 * resumes above the last position written rather than rescanning rows already
 * converted: startup cancels this task after two minutes, and a large corpus
 * would otherwise spend every boot re-reading its converted prefix. Only a
 * restore can reintroduce earlier rows below that position, which is why it
 * calls `resetVectorFormatMigration`. The completion flag spares a full scan
 * once a pass has found nothing left to rewrite.
 */
export async function runVectorFormatMigration(
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  if (
    await getPlasmoStoredValue<boolean>(
      STORAGE_KEYS.EMBEDDINGS.VECTOR_FORMAT_MIGRATED
    )
  )
    return

  const saved = await getPlasmoStoredValue<number>(
    STORAGE_KEYS.EMBEDDINGS.VECTOR_FORMAT_PROGRESS
  )
  let lastId = typeof saved === "number" && saved > 0 ? saved : 0
  let savedId = lastId
  const saveProgress = async () => {
    if (lastId <= savedId) return
    await setPlasmoStoredValue(
      STORAGE_KEYS.EMBEDDINGS.VECTOR_FORMAT_PROGRESS,
      lastId
    )
    savedId = lastId
  }
  let rewritten = 0
  let batches = 0
  try {
    for (;;) {
      signal?.throwIfAborted()
      const outcome = await vectorDb.transaction(
        "rw",
        vectorDb.vectors,
        vectorDb.vectorStats,
        async () => {
          const batch = await vectorDb.vectors
            .where(":id")
            .above(lastId)
            .limit(BATCH_SIZE)
            .toArray()
          if (batch.length === 0)
            return { done: true, changed: 0, lastId: undefined }
          const delta = emptyVectorStorageStats()
          const replacements = []
          for (const row of batch) {
            if (!isLegacyVectorRow(row)) continue
            const after = encodeVectorDocument(row)
            recordVectorStorageChange(delta, { before: row, after })
            replacements.push(after)
          }
          if (replacements.length > 0) {
            await vectorDb.vectors.bulkPut(replacements)
            await applyVectorStorageDelta(vectorDb.vectorStats, delta)
          }
          return {
            done: false,
            changed: replacements.length,
            lastId: batch[batch.length - 1].id!
          }
        }
      )
      if (outcome.done) break
      // Advance only once the transaction has committed: the callback returning
      // is not the commit, and a position saved for rows that rolled back would
      // make the next run skip them for good.
      lastId = outcome.lastId!
      rewritten += outcome.changed
      batches += 1
      if (batches % PROGRESS_EVERY_BATCHES === 0) await saveProgress()
      // Yield only after real work; a batch that was already converted costs
      // one read and no pause.
      if (outcome.changed > 0) await abortableDelay(DELAY_MS, signal)
    }
  } finally {
    await saveProgress().catch(() => undefined)
  }

  signal?.throwIfAborted()
  await setPlasmoStoredValue(
    STORAGE_KEYS.EMBEDDINGS.VECTOR_FORMAT_MIGRATED,
    true
  )
  await removePlasmoStoredValue(STORAGE_KEYS.EMBEDDINGS.VECTOR_FORMAT_PROGRESS)
  logger.info("Vector format migration completed", "VectorFormatMigration", {
    rewritten
  })
}
