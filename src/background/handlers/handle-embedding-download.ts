import { getBaseUrl } from "@/background/lib/utils"
import { DEFAULT_EMBEDDING_MODEL, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { OllamaPullRequest } from "@/types"

/**
 * Checks if the embedding model is already downloaded
 */
export const checkEmbeddingModelExists = async (
  modelName: string = DEFAULT_EMBEDDING_MODEL
): Promise<boolean> => {
  try {
    const baseUrl = await getBaseUrl()
    const res = await fetch(`${baseUrl}/api/tags`)

    if (!res.ok) {
      logger.warn(
        "Failed to check for embedding model",
        "checkEmbeddingModelExists",
        { status: res.statusText }
      )
      return false
    }

    const data = await res.json()
    const models = data.models || []

    // Normalize model names for comparison (remove tags)
    const normalizeModelName = (name: string): string => {
      // Remove tag (e.g., "nomic-embed-text:latest" -> "nomic-embed-text")
      return name.split(":")[0]
    }

    const normalizedSearchName = normalizeModelName(modelName)

    const found = models.some((model: { name: string }) => {
      const normalizedModelName = normalizeModelName(model.name)
      // Check exact match or normalized match
      return (
        model.name === modelName ||
        normalizedModelName === normalizedSearchName ||
        model.name.startsWith(`${modelName}:`) ||
        model.name.startsWith(`${normalizedSearchName}:`)
      )
    })

    logger.verbose(
      "Embedding model search result",
      "checkEmbeddingModelExists",
      {
        modelName,
        normalizedSearchName,
        found
      }
    )

    return found
  } catch (error) {
    logger.error(
      "Error checking embedding model",
      "checkEmbeddingModelExists",
      { error }
    )
    return false
  }
}

/**
 * Downloads the embedding model silently (without UI feedback)
 * Used for auto-download on installation
 */
export const downloadEmbeddingModelSilently = async (
  modelName: string = DEFAULT_EMBEDDING_MODEL
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Check if model already exists
    const exists = await checkEmbeddingModelExists(modelName)
    if (exists) {
      logger.info(
        "Embedding model already exists",
        "downloadEmbeddingModelSilently",
        { modelName }
      )
      await plasmoGlobalStorage.set(
        STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED,
        true
      )
      return { success: true }
    }

    const baseUrl = await getBaseUrl()
    const requestBody: OllamaPullRequest = {
      name: modelName,
      stream: false // Don't stream for silent download
    }

    const res = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    })

    if (!res.ok) {
      const errorText = await res.text()
      logger.error(
        "Failed to download embedding model",
        "downloadEmbeddingModelSilently",
        {
          status: res.status,
          error: errorText
        }
      )
      return {
        success: false,
        error: `HTTP ${res.status}: ${res.statusText}`
      }
    }

    // Mark as auto-downloaded
    await plasmoGlobalStorage.set(STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED, true)
    await plasmoGlobalStorage.set(
      STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
      modelName
    )

    logger.info(
      "Successfully downloaded embedding model",
      "downloadEmbeddingModelSilently",
      { modelName }
    )
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(
      "Error downloading embedding model",
      "downloadEmbeddingModelSilently",
      { error: errorMessage }
    )
    return {
      success: false,
      error: errorMessage
    }
  }
}
