import { getBaseUrl } from "@/background/lib/utils"
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  MESSAGE_KEYS,
  normalizeEmbeddingModelName,
  STORAGE_KEYS
} from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChromeResponse, DefaultProviderPullRequest } from "@/types"

/**
 * Checks if the embedding model is already downloaded
 */
export const checkEmbeddingModelExists = async (
  modelName: string = DEFAULT_EMBEDDING_MODEL,
  providerId?: string
): Promise<{ exists: boolean; debug?: object }> => {
  const normalizedModelName = normalizeEmbeddingModelName(modelName)
  let providerDebug: object | null = null
  let providerBaseUrl: string | undefined
  let resolvedProviderId = providerId
  const startTime = Date.now()
  const CHECK_TIMEOUT_MS = 4000

  const withTimeout = async <T>(
    promise: Promise<T>,
    label: string
  ): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`${label} timed out`)),
        CHECK_TIMEOUT_MS
      )
    })
    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  logger.info("Checking embedding model", "checkEmbeddingModelExists", {
    modelName: normalizedModelName,
    providerId
  })

  const checkDefaultProviderTags = async (): Promise<{
    exists: boolean
    debug: object
  } | null> => {
    try {
      const baseUrl = providerBaseUrl || (await getBaseUrl())
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort("Status check timed out"),
        CHECK_TIMEOUT_MS
      )
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

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
      const normalizedSearchName = normalizeModelName(normalizedModelName)

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
          const normalizedCandidate = normalizeModelName(name)
          return (
            name === normalizedModelName ||
            normalizedCandidate === normalizedSearchName ||
            name.startsWith(`${normalizedModelName}:`) ||
            name.startsWith(`${normalizedSearchName}:`)
          )
        })

      const result = {
        exists: found,
        debug: {
          ...providerDebug,
          fallback: {
            found,
            normalizedModelName,
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

      logger.info(
        "Embedding model fallback result",
        "checkEmbeddingModelExists",
        {
          modelName: normalizedModelName,
          providerId: resolvedProviderId || DEFAULT_PROVIDER_ID,
          exists: result.exists,
          durationMs: Date.now() - startTime,
          method: "fallback"
        }
      )
      return result
    } catch (error) {
      logger.error(
        "Error checking embedding model (fallback)",
        "checkEmbeddingModelExists",
        { error }
      )
      return {
        exists: false,
        debug: { ...providerDebug, fallbackError: error }
      }
    }
  }

  // For default provider, prefer direct tag check to avoid slow provider resolution.
  if (
    (resolvedProviderId && resolvedProviderId === DEFAULT_PROVIDER_ID) ||
    normalizedModelName === DEFAULT_EMBEDDING_MODEL
  ) {
    const fallbackResult = await checkDefaultProviderTags()
    if (fallbackResult) {
      return fallbackResult
    }
  }

  // Try High-Level Provider Check
  try {
    const { ProviderFactory } = await import("@/lib/providers/factory")
    const provider = providerId
      ? await ProviderFactory.getProvider(providerId)
      : await ProviderFactory.getProviderForModel(normalizedModelName)

    if (provider) {
      resolvedProviderId = provider.id
      providerBaseUrl = provider.config.baseUrl
      const models = await withTimeout(
        provider.getModels(),
        "Provider model list"
      )
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
        `[checkEmbeddingModelExists] Checking '${normalizedModelName}' against provider models:`,
        modelNames
      )

      // Normalize model names for comparison (remove tags)
      const normalizeModelName = (name: string): string =>
        name.split(":")[0] || name
      const normalizedSearchName = normalizeModelName(normalizedModelName)

      const found = modelNames.some((m: string) => {
        const normalizedCandidate = normalizeModelName(m)
        const isMatch =
          m === normalizedModelName ||
          normalizedCandidate === normalizedSearchName ||
          m.startsWith(`${normalizedModelName}:`) ||
          m.startsWith(`${normalizedSearchName}:`)
        if (isMatch) {
          console.log(
            `[checkEmbeddingModelExists] Found match: '${m}' matches '${normalizedModelName}'`
          )
        }
        return isMatch
      })

      if (found) {
        logger.info(
          "Embedding model found via provider",
          "checkEmbeddingModelExists",
          {
            modelName: normalizedModelName,
            providerId: provider.id,
            durationMs: Date.now() - startTime,
            method: "provider"
          }
        )
        return {
          exists: true,
          debug: {
            provider: provider.config.id || provider.id,
            models: modelNames,
            method: "provider"
          }
        }
      }

      providerDebug = {
        provider: provider.config.id || provider.id,
        models: modelNames,
        method: "provider-failed-not-found"
      }
      console.warn(
        `[checkEmbeddingModelExists] Model '${normalizedModelName}' NOT found in provider models.`
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
    if (resolvedProviderId && resolvedProviderId !== DEFAULT_PROVIDER_ID) {
      return {
        exists: false,
        debug: {
          ...providerDebug,
          fallback: {
            method: "fallback-skipped",
            providerId: resolvedProviderId
          }
        }
      }
    }

    const fallbackResult = await checkDefaultProviderTags()
    if (fallbackResult) {
      return fallbackResult
    }
  } catch (error) {
    logger.error(
      "Error checking embedding model (fallback)",
      "checkEmbeddingModelExists",
      { error }
    )
    return {
      exists: false,
      debug: { ...providerDebug, fallbackError: error }
    }
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
    const normalizedModelName = normalizeEmbeddingModelName(modelName)
    // Check if model already exists
    const result = await checkEmbeddingModelExists(normalizedModelName)
    if (result.exists) {
      logger.info(
        "Embedding model already exists",
        "downloadEmbeddingModelSilently",
        { modelName: normalizedModelName }
      )
      await plasmoGlobalStorage.set(
        STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED,
        true
      )
      return { success: true }
    }

    const baseUrl = await getBaseUrl()
    const requestBody: DefaultProviderPullRequest = {
      name: normalizedModelName,
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
      normalizedModelName
    )

    logger.info(
      "Successfully downloaded embedding model",
      "downloadEmbeddingModelSilently",
      { modelName: normalizedModelName }
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
  const modelName = normalizeEmbeddingModelName(
    payload.model || DEFAULT_EMBEDDING_MODEL
  )

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
