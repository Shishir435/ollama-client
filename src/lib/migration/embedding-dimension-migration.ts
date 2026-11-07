import { abortableDelay } from "@/lib/abortable-delay"
import { vectorDb } from "@/lib/embeddings/db"
import {
  encodeVectorDocument,
  vectorDimension
} from "@/lib/embeddings/vector-codec"
import { applyVectorStorageChanges } from "@/lib/embeddings/vector-storage-stats"
import { logger } from "@/lib/logger"
import {
  getPlasmoStoredValue,
  removePlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"

const MIGRATION_KEY = "embeddings.migration.embedding_dim.v1.completed"
const MIGRATION_PROGRESS_KEY = "embeddings.migration.embedding_dim.v1.progress"
const BATCH_SIZE = 200
const DELAY_MS = 200

interface MigrationProgress {
  processed: number
  total: number
  updated: number
}

export async function runEmbeddingDimensionMigration(
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  const completed = await getPlasmoStoredValue<boolean>(MIGRATION_KEY)
  signal?.throwIfAborted()
  if (completed) {
    return
  }

  const total = await vectorDb.vectors.count()
  signal?.throwIfAborted()
  const progress: MigrationProgress =
    (await getPlasmoStoredValue<MigrationProgress>(MIGRATION_PROGRESS_KEY)) || {
      processed: 0,
      total,
      updated: 0
    }

  logger.info(
    "Starting embedding dimension migration",
    "EmbeddingDimMigration",
    progress
  )

  for (let offset = progress.processed; offset < total; offset += BATCH_SIZE) {
    signal?.throwIfAborted()
    const batch = await vectorDb.vectors
      .orderBy("id")
      .offset(offset)
      .limit(BATCH_SIZE)
      .toArray()
    signal?.throwIfAborted()

    if (batch.length === 0) {
      break
    }

    for (const doc of batch) {
      signal?.throwIfAborted()
      if (!doc.id) continue
      if (doc.metadata?.embeddingDim) continue

      const updated = await vectorDb.transaction(
        "rw",
        vectorDb.vectors,
        vectorDb.vectorStats,
        async () => {
          const before = await vectorDb.vectors.get(doc.id!)
          if (!before || before.metadata?.embeddingDim) return false
          const after = encodeVectorDocument({
            ...before,
            embedding: before.embedding,
            metadata: {
              ...before.metadata,
              embeddingDim: vectorDimension(before)
            }
          })
          await vectorDb.vectors.put(after)
          await applyVectorStorageChanges(vectorDb.vectorStats, [
            { before, after }
          ])
          return true
        }
      )
      if (updated) progress.updated++
    }

    progress.processed = Math.min(offset + batch.length, total)
    await setPlasmoStoredValue(MIGRATION_PROGRESS_KEY, progress)

    await abortableDelay(DELAY_MS, signal)
  }

  signal?.throwIfAborted()
  await setPlasmoStoredValue(MIGRATION_KEY, true)
  await removePlasmoStoredValue(MIGRATION_PROGRESS_KEY)
  signal?.throwIfAborted()

  logger.info(
    "Embedding dimension migration completed",
    "EmbeddingDimMigration",
    progress
  )
}
