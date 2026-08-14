import { vectorDb } from "@/lib/embeddings/db"
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

const abortableDelay = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
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

      try {
        await vectorDb.vectors.update(doc.id, {
          metadata: {
            ...doc.metadata,
            embeddingDim: doc.embedding.length
          }
        })
        progress.updated++
      } catch (error) {
        logger.warn(
          "Failed to update embedding dimension",
          "EmbeddingDimMigration",
          { id: doc.id, error }
        )
      }
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
