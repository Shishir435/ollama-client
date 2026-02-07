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
): Promise<{ exists: boolean; debug?: any }> => {
  let providerDebug: any = null

  // Try High-Level Provider Check
  try {
    const { ProviderFactory } = await import("@/lib/providers/factory")
    const provider = await ProviderFactory.getProviderForModel(modelName)

    if (provider) {
      const models = await provider.getModels()
      console.log(
        `[checkEmbeddingModelExists] Checking '${modelName}' against provider models:`,
        models
      )

      // Normalize model names for comparison (remove tags)
      const normalizeModelName = (name: string): string => name.split(":")[0]
      const normalizedSearchName = normalizeModelName(modelName)

      const found = models.some((m: string) => {
        const normalizedModelName = normalizeModelName(m)
        const isMatch =
          m === modelName ||
          normalizedModelName === normalizedSearchName ||
          m.startsWith(`${modelName}:`) ||
          m.startsWith(`${normalizedSearchName}:`)
        if (isMatch) {
          console.log(
            `[checkEmbeddingModelExists] Found match: '${m}' matches '${modelName}'`
          )
        }
        return isMatch
      })

      if (found) {
        return {
          exists: true,
          debug: { provider: provider.config.id, models, method: "provider" }
        }
      }

      providerDebug = {
        provider: provider.config.id,
        models,
        method: "provider-failed-not-found"
      }
      console.warn(
        `[checkEmbeddingModelExists] Model '${modelName}' NOT found in provider models.`
      )
    }
  } catch (error) {
    console.warn(
      "[checkEmbeddingModelExists] Provider check failed, trying fallback",
      error
    )
    providerDebug = { error, method: "provider-error" }
  }

  // Fallback/Legacy: If provider check didn't find it, or failed, try direct Ollama check
  try {
    const baseUrl = await getBaseUrl()
    const res = await fetch(`${baseUrl}/api/tags`)

    if (!res.ok) {
      return {
        exists: false,
        debug: {
          ...providerDebug,
          fallback: { baseUrl, status: res.status, method: "fallback-failed" }
        }
      }
    }

    const data = await res.json()
    const ollamaModels = data.models || []

    const normalizeModelName = (name: string): string => name.split(":")[0]
    const normalizedSearchName = normalizeModelName(modelName)

    const found = ollamaModels.some((model: { name: string }) => {
      const normalizedModelName = normalizeModelName(model.name)
      return (
        model.name === modelName ||
        normalizedModelName === normalizedSearchName ||
        model.name.startsWith(`${modelName}:`) ||
        model.name.startsWith(`${normalizedSearchName}:`)
      )
    })

    return {
      exists: found,
      debug: {
        ...providerDebug,
        fallback: {
          found,
          models: ollamaModels.map((m: any) => m.name),
          method: "fallback"
        }
      }
    }
  } catch (error) {
    logger.error(
      "Error checking embedding model (fallback)",
      "checkEmbeddingModelExists",
      { error }
    )
    return { exists: false, debug: { ...providerDebug, fallbackError: error } }
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
    const result = await checkEmbeddingModelExists(modelName)
    if (result.exists) {
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
