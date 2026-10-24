import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
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

  const vectorCount = await vectorDb.vectors.count()
  if (vectorCount === 0) {
    logger.verbose("No vectors to index", "buildKeywordIndexFromExisting")
    if (forceRebuild) keywordIndexManager.clear()
    await setPlasmoStoredValue(
      STORAGE_KEYS.EMBEDDINGS.KEYWORD_INDEX_BUILT,
      true
    )
    return
  }

  // Force rebuilds replace the in-memory index even when its persisted marker
  // says a build completed earlier.
  const allVectors = await vectorDb.vectors.toArray()
  await keywordIndexManager.buildFromDocuments(allVectors, onProgress)

  // Mark as built
  await setPlasmoStoredValue(STORAGE_KEYS.EMBEDDINGS.KEYWORD_INDEX_BUILT, true)

  const duration = performance.now() - startTime
  logger.info("Keyword index build complete", "buildKeywordIndexFromExisting", {
    documentCount: vectorCount,
    duration: `${duration.toFixed(2)}ms`
  })
}

/**
 * Check if keyword index needs to be built
 * Returns true if index is already built
 */
export async function isKeywordIndexBuilt(): Promise<boolean> {
  const built = await getPlasmoStoredValue<boolean>(
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

  if (!isBuilt) {
    logger.verbose(
      "Loading/Building keyword index",
      "ensureKeywordIndexBuilt",
      {
        isBuilt,
        docCount: stats.documentCount
      }
    )
    await buildKeywordIndexFromExisting(onProgress)
    return
  }

  if (stats.documentCount === 0 && (await vectorDb.vectors.count()) > 0) {
    logger.verbose(
      "Loading keyword index into memory",
      "ensureKeywordIndexBuilt"
    )
    await buildKeywordIndexFromExisting(onProgress, true)
  }
}
