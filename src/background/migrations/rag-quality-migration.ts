import { assessContentQuality } from "@/lib/embeddings/content-quality-filter"
import { vectorDb } from "@/lib/embeddings/db"
import { generateEmbedding } from "@/lib/embeddings/embedding-client"
import { storeVector } from "@/lib/embeddings/storage"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

interface VectorRecord {
  id: number
  content: string
  embedding: number[]
  metadata: {
    type: string
    role?: string
    sessionId?: string
    timestamp: number
    [key: string]: unknown
  }
}

/**
 * Background Migration: Re-embed Chat History with Quality Filters
 *
 * This migration runs in the background on extension startup/update
 * - Removes low-quality embeddings (greetings, affirmations, etc.)
 * - Re-embeds borderline content with quality metadata
 * - Non-blocking, resumable, and transparent to users
 */

const MIGRATION_KEY = "rag.migration.v1.completed"
const MIGRATION_PROGRESS_KEY = "rag.migration.v1.progress"
const BATCH_SIZE = 10 // Process 10 messages at a time
const DELAY_MS = 2000 // 2s between batches to avoid blocking

interface MigrationProgress {
  processed: number
  total: number
  deleted: number
  reembedded: number
  kept: number
  lastProcessedId?: number
}

/**
 * Check if migration is needed
 */
export async function isMigrationNeeded(): Promise<boolean> {
  const completed = await plasmoGlobalStorage.get<boolean>(MIGRATION_KEY)
  return !completed
}

/**
 * Get migration progress
 */
export async function getMigrationProgress(): Promise<MigrationProgress | null> {
  return await plasmoGlobalStorage.get<MigrationProgress>(
    MIGRATION_PROGRESS_KEY
  )
}

/**
 * Run RAG quality migration
 *
 * This function is safe to call multiple times (idempotent)
 * Progress is saved and migration can be resumed
 */
export async function runRAGQualityMigration(): Promise<void> {
  // Check if already completed
  const completed = await plasmoGlobalStorage.get<boolean>(MIGRATION_KEY)
  if (completed) {
    logger.info("RAG quality migration already completed", "RAGMigration")
    return
  }

  logger.info("🔄 Starting RAG quality migration...", "RAGMigration")

  try {
    // Get all chat-type vectors from SQL.js DB
    // Note: This needs to be adapted to your actual SQL.js schema
    const allVectors = await getAllChatVectors()

    logger.info(
      `Found ${allVectors.length} chat vectors to process`,
      "RAGMigration"
    )

    // Load previous progress if exists
    const progress: MigrationProgress =
      (await plasmoGlobalStorage.get<MigrationProgress>(
        MIGRATION_PROGRESS_KEY
      )) || {
        processed: 0,
        total: allVectors.length,
        deleted: 0,
        reembedded: 0,
        kept: 0
      }

    // Process in batches
    for (let i = progress.processed; i < allVectors.length; i += BATCH_SIZE) {
      const batch = allVectors.slice(i, i + BATCH_SIZE)

      for (const vector of batch) {
        // Assess content quality
        const quality = assessContentQuality(
          vector.content,
          vector.metadata.role || "user"
        )

        if (!quality.shouldEmbed) {
          // Delete low-quality embedding
          await deleteVector(vector.id)
          progress.deleted++

          logger.debug(
            `Deleted low-quality vector: "${vector.content.substring(0, 50)}..."`,
            "RAGMigration",
            {
              reasons: quality.reasons,
              score: quality.score
            }
          )
        } else if (quality.score < 0.6) {
          // Re-embed borderline content with quality metadata
          await deleteVector(vector.id)

          const newEmbedding = await generateEmbedding(vector.content)
          if (!("error" in newEmbedding)) {
            await storeVector(vector.content, newEmbedding.embedding, {
              ...vector.metadata,
              type: vector.metadata.type as "chat" | "file" | "webpage",
              role: vector.metadata.role as
                | "user"
                | "assistant"
                | "system"
                | undefined,
              source: (vector.metadata.source as string) || "chat",
              qualityScore: quality.score,
              qualityReasons: quality.reasons.join(", ")
            })
            progress.reembedded++

            logger.debug(
              `Re-embedded borderline vector with quality=${quality.score.toFixed(2)}`,
              "RAGMigration"
            )
          }
        } else {
          // Keep high-quality embeddings as-is
          progress.kept++
        }

        progress.processed++
        progress.lastProcessedId = vector.id
      }

      // Save progress
      await plasmoGlobalStorage.set(MIGRATION_PROGRESS_KEY, progress)

      // Progress logging
      const percentComplete = Math.round(
        (progress.processed / allVectors.length) * 100
      )
      logger.info(
        `Migration progress: ${progress.processed}/${allVectors.length} (${percentComplete}%)`,
        "RAGMigration"
      )

      // Delay between batches to avoid blocking main thread
      if (i + BATCH_SIZE < allVectors.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
      }
    }

    // Mark migration as complete
    await plasmoGlobalStorage.set(MIGRATION_KEY, true)
    await plasmoGlobalStorage.remove(MIGRATION_PROGRESS_KEY)

    logger.info(
      `✅ RAG migration complete! Deleted: ${progress.deleted}, Re-embedded: ${progress.reembedded}, Kept: ${progress.kept}`,
      "RAGMigration"
    )
  } catch (error) {
    logger.error("RAG migration failed", "RAGMigration", { error })
    // Don't throw - allow app to continue functioning
    // Progress is saved, migration will resume on next startup
  }
}

/**
 * Reset migration (for testing only)
 */
export async function resetMigration(): Promise<void> {
  await plasmoGlobalStorage.remove(MIGRATION_KEY)
  await plasmoGlobalStorage.remove(MIGRATION_PROGRESS_KEY)
  logger.info("Migration reset", "RAGMigration")
}

/**
 * Get all chat-type vectors from Dexie
 */
async function getAllChatVectors(): Promise<VectorRecord[]> {
  try {
    const vectors = await vectorDb.vectors
      .where("metadata.type")
      .equals("chat")
      .toArray()

    return vectors.map(
      (v) =>
        ({
          id: v.id ?? 0,
          content: v.content,
          embedding: v.embedding,
          metadata: v.metadata
        }) as VectorRecord
    )
  } catch (error) {
    logger.error("Failed to load chat vectors", "RAGMigration", { error })
    return []
  }
}

/**
 * Delete a vector by ID
 */
async function deleteVector(id: number): Promise<void> {
  try {
    await vectorDb.vectors.delete(id)
    logger.debug(`Deleted vector ${id}`, "RAGMigration")
  } catch (error) {
    logger.warn(`Failed to delete vector ${id}`, "RAGMigration", { error })
  }
}
