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
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"

const BATCH_SIZE = 200
const DELAY_MS = 20

/**
 * Rewrites saved vectors from float64 `number[]` pairs to the float32 shape.
 *
 * Each batch is one transaction that re-reads its rows by id, so a vector
 * stored or replaced meanwhile is never overwritten with a stale copy, and the
 * storage totals change in the same commit as the rows. The pass is keyed on
 * row shape, not on progress: a worker lost mid-run, or a backup restored with
 * older rows, is simply finished by the next run. The completion flag only
 * spares a full scan once a pass has found nothing left to rewrite.
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

  let lastId = 0
  let rewritten = 0
  for (;;) {
    signal?.throwIfAborted()
    const done = await vectorDb.transaction(
      "rw",
      vectorDb.vectors,
      vectorDb.vectorStats,
      async () => {
        const batch = await vectorDb.vectors
          .where(":id")
          .above(lastId)
          .limit(BATCH_SIZE)
          .toArray()
        if (batch.length === 0) return true
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
          rewritten += replacements.length
        }
        lastId = batch[batch.length - 1].id!
        return false
      }
    )
    if (done) break
    await abortableDelay(DELAY_MS, signal)
  }

  signal?.throwIfAborted()
  await setPlasmoStoredValue(
    STORAGE_KEYS.EMBEDDINGS.VECTOR_FORMAT_MIGRATED,
    true
  )
  logger.info("Vector format migration completed", "VectorFormatMigration", {
    rewritten
  })
}
