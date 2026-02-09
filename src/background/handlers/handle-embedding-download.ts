import { getBaseUrl } from "@/background/lib/utils"
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChromeResponse, DefaultProviderPullRequest } from "@/types"

/**
 * Checks if the embedding model is already downloaded
 */
export const checkEmbeddingModelExists = async (
  modelName: string = DEFAULT_EMBEDDING_MODEL
): Promise<{ exists: boolean; debug?: object }> => {
  let providerDebug: object | null = null

  // Try High-Level Provider Check
  try {
    const { ProviderFactory } = await import("@/lib/providers/factory")
    // Default provider handles embedding checks in current runtime
    const provider = await ProviderFactory.getProvider(DEFAULT_PROVIDER_ID)

    if (provider) {
      const models = await provider.getModels()
      const modelNames = models
        .map((model: unknown) => {
          if (typeof model === "string") return model
          if (model && typeof model === "object") {
            const maybeName = (model as { name?: string; model?: string }).name
            const maybeModel = (model as { model?: string }).model
            return maybeName || maybeModel || ""
          }
          return ""
        })
        .filter((name) => name.length > 0)
      console.log(
        `[checkEmbeddingModelExists] Checking '${modelName}' against provider models:`,
        modelNames
      )

      // Normalize model names for comparison (remove tags)
      const normalizeModelName = (name: string): string =>
        name.split(":")[0] || name
      const normalizedSearchName = normalizeModelName(modelName)

      const found = modelNames.some((m: string) => {
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
          debug: {
            provider: provider.config.id,
            models: modelNames,
            method: "provider"
          }
        }
      }

      providerDebug = {
        provider: provider.config.id,
        models: modelNames,
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

  // Fallback/Legacy: If provider check didn't find it, or failed, try direct default-provider check
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
    const providerModels = Array.isArray(data.models) ? data.models : []

    const normalizeModelName = (name: string): string =>
      name.split(":")[0] || name
    const normalizedSearchName = normalizeModelName(modelName)

    const found = providerModels
      .map((model: unknown) => {
        if (typeof model === "string") return model
        if (model && typeof model === "object") {
          const maybeName = (model as { name?: string; model?: string }).name
          const maybeModel = (model as { model?: string }).model
          return maybeName || maybeModel || ""
        }
        return ""
      })
      .filter((name) => name.length > 0)
      .some((name) => {
        const normalizedModelName = normalizeModelName(name)
        return (
          name === modelName ||
          normalizedModelName === normalizedSearchName ||
          name.startsWith(`${modelName}:`) ||
          name.startsWith(`${normalizedSearchName}:`)
        )
      })

    return {
      exists: found,
      debug: {
        ...providerDebug,
        fallback: {
          found,
          models: providerModels
            .map((model: unknown) => {
              if (typeof model === "string") return model
              if (model && typeof model === "object") {
                return (
                  (model as { name?: string; model?: string }).name ||
                  (model as { model?: string }).model ||
                  ""
                )
              }
              return ""
            })
            .filter((name) => name.length > 0),
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
    const requestBody: DefaultProviderPullRequest = {
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

interface PrepareEmbeddingPayload {
  model?: string
  providerId?: string
}

/**
 * Best-effort embedding model preparation.
 * Keeps behavior non-blocking and only performs model pull for the default provider.
 */
export const prepareEmbeddingModel = async (
  payload: PrepareEmbeddingPayload = {}
): Promise<{ ready: boolean; prepared: boolean; error?: string }> => {
  const providerId = payload.providerId || DEFAULT_PROVIDER_ID
  const modelName = payload.model || DEFAULT_EMBEDDING_MODEL

  // Only the default provider supports model pull in current runtime.
  if (providerId !== DEFAULT_PROVIDER_ID) {
    return { ready: true, prepared: false }
  }

  const existsResult = await checkEmbeddingModelExists(modelName)
  if (existsResult.exists) {
    return { ready: true, prepared: false }
  }

  const downloadResult = await downloadEmbeddingModelSilently(modelName)
  if (downloadResult.success) {
    return { ready: true, prepared: true }
  }

  return {
    ready: false,
    prepared: false,
    error: downloadResult.error
  }
}

/**
 * Runtime message handler used by the embedding fallback chain.
 */
export const handlePrepareEmbeddingModel = async (
  payload: unknown,
  sendResponse: (response: ChromeResponse) => void
) => {
  try {
    const prepared = await prepareEmbeddingModel(
      (payload as PrepareEmbeddingPayload) || {}
    )

    sendResponse({
      success: true,
      data: prepared
    })
  } catch (error) {
    logger.error(
      "Failed to prepare embedding model",
      MESSAGE_KEYS.PROVIDER.PREPARE_EMBEDDING_MODEL,
      {
        error
      }
    )
    sendResponse({
      success: false,
      error: {
        status: 0,
        message: error instanceof Error ? error.message : String(error)
      }
    })
  }
}
