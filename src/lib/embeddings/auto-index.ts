import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { keywordIndexManager } from "./keyword-index"
import { vectorDb } from "./vector-store"

/**
 * Build keyword index from all existing vectors
 * This is a one-time background operation for backward compatibility
 */
export async function buildKeywordIndexFromExisting(
  onProgress?: (current: number, total: number) => void,
  forceRebuild = false
): Promise<void> {
  logger.info(
    "Starting keyword index build from existing vectors",
    "buildKeywordIndexFromExisting"
  )
  const startTime = performance.now()

  // If not forcing rebuild, check if already built
  if (!forceRebuild) {
    const isBuilt = await isKeywordIndexBuilt()
    if (isBuilt) {
      logger.verbose(
        "Keyword index already built, skipping",
        "buildKeywordIndexFromExisting"
      )
      return
    }
  }

  // Get all vectors
  const allVectors = await vectorDb.vectors.toArray()

  if (allVectors.length === 0) {
    logger.verbose("No vectors to index", "buildKeywordIndexFromExisting")
    await plasmoGlobalStorage.set(
      STORAGE_KEYS.EMBEDDINGS.KEYWORD_INDEX_BUILT,
      true
    )
    return
  }

  // Build index in batches
  await keywordIndexManager.buildFromDocuments(allVectors, onProgress)

  // Mark as built
  await plasmoGlobalStorage.set(
    STORAGE_KEYS.EMBEDDINGS.KEYWORD_INDEX_BUILT,
    true
  )

  const duration = performance.now() - startTime
  logger.info("Keyword index build complete", "buildKeywordIndexFromExisting", {
    documentCount: allVectors.length,
    duration: `${duration.toFixed(2)}ms`
  })
}

/**
 * Check if keyword index needs to be built
 * Returns true if index is already built
 */
export async function isKeywordIndexBuilt(): Promise<boolean> {
  const built = await plasmoGlobalStorage.get<boolean>(
    STORAGE_KEYS.EMBEDDINGS.KEYWORD_INDEX_BUILT
  )
  return built ?? false
}

/**
 * Auto-build keyword index on first use (lazy initialization)
 * This ensures backward compatibility without blocking app startup
 */
export async function ensureKeywordIndexBuilt(
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const isBuilt = await isKeywordIndexBuilt()
  const stats = keywordIndexManager.getStats()

  // If index is marked as built but memory is empty (app reload), we need to load it
  // Or if it's never been built, we need to build it
  if (!isBuilt || stats.documentCount === 0) {
    logger.verbose(
      "Loading/Building keyword index",
      "ensureKeywordIndexBuilt",
      {
        isBuilt,
        docCount: stats.documentCount
      }
    )
    // We reuse the build function which clears and rebuilds from Dexie
    // This effectively loads the index into memory
    await buildKeywordIndexFromExisting(onProgress, true)
  }
}
