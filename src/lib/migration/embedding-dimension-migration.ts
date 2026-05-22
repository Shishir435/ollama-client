import { vectorDb } from "@/lib/embeddings/db"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

const MIGRATION_KEY = "embeddings.migration.embedding_dim.v1.completed"
const MIGRATION_PROGRESS_KEY = "embeddings.migration.embedding_dim.v1.progress"
const BATCH_SIZE = 200
const DELAY_MS = 200

interface MigrationProgress {
  processed: number
  total: number
  updated: number
}

export async function runEmbeddingDimensionMigration(): Promise<void> {
  const completed = await plasmoGlobalStorage.get<boolean>(MIGRATION_KEY)
  if (completed) {
    return
  }

  const total = await vectorDb.vectors.count()
  const progress: MigrationProgress =
    (await plasmoGlobalStorage.get<MigrationProgress>(
      MIGRATION_PROGRESS_KEY
    )) || {
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
    const batch = await vectorDb.vectors
      .orderBy("id")
      .offset(offset)
      .limit(BATCH_SIZE)
      .toArray()

    if (batch.length === 0) {
      break
    }

    for (const doc of batch) {
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
    await plasmoGlobalStorage.set(MIGRATION_PROGRESS_KEY, progress)

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
  }

  await plasmoGlobalStorage.set(MIGRATION_KEY, true)
  await plasmoGlobalStorage.remove(MIGRATION_PROGRESS_KEY)

  logger.info(
    "Embedding dimension migration completed",
    "EmbeddingDimMigration",
    progress
  )
}
