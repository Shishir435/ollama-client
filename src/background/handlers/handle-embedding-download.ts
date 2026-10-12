import {
  type AbortTimeout,
  createAbortTimeout
} from "@ollama-client/runtime-core/cancellation"
import { EMBEDDING_DOWNLOAD_TIMEOUT_MS } from "@/background/lib/fetch-timeout"
import { notifyJobComplete } from "@/background/lib/notify"
import { getOllamaBaseUrl } from "@/background/lib/ollama-base-url"
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  normalizeEmbeddingModelName,
  STORAGE_KEYS
} from "@/lib/constants"
import { createAppError, getErrorMessage } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { setPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import { discoverProviderModels } from "@/lib/providers/model-discovery"
import type { LLMProvider } from "@/lib/providers/types"
import { writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import type { DefaultProviderPullRequest } from "@/types"

const abortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Embedding request cancelled", "AbortError")

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError(signal)
}

const forwardAbort = (
  source: AbortSignal | undefined,
  target: AbortController
): (() => void) => {
  if (!source) return () => {}
  const abort = () => target.abort(source.reason)
  if (source.aborted) abort()
  else source.addEventListener("abort", abort, { once: true })
  return () => source.removeEventListener("abort", abort)
}

const commitDownloadedEmbeddingModel = async (
  modelName: string,
  signal?: AbortSignal
): Promise<void> => {
  throwIfAborted(signal)

  // Treat the completion marker as the commit record. Storage writes are not
  // abortable, so once this pair starts it must finish without observing
  // cancellation between writes. If the second write fails, the model may be
  // selected but the preparation is not falsely recorded as complete.
  await writeSetting(SETTINGS.EMBEDDING_SELECTED_MODEL, modelName)
  await setPlasmoStoredValue(STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED, true)

  // Preserve cancellation semantics for the RPC caller after state is
  // consistent, even if cancellation arrived during the commit section.
  throwIfAborted(signal)
}

/** A catalog failure is not proof that an embedding model is missing. */
export const checkEmbeddingModelExists = async (
  modelName: string = DEFAULT_EMBEDDING_MODEL,
  providerId?: string,
  signal?: AbortSignal
): Promise<{
  exists: boolean
  status: "available" | "missing" | "unavailable" | "unverified"
  canDownload: boolean
}> => {
  throwIfAborted(signal)
  const CHECK_TIMEOUT_MS = 4000
  const withTimeout = async <T>(
    operation: (operationSignal: AbortSignal) => Promise<T>,
    label: string
  ): Promise<T> => {
    throwIfAborted(signal)
    const controller = new AbortController()
    const stopForwarding = forwardAbort(signal, controller)
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort(`${label} timed out`)
        reject(
          createAppError(`${label} timed out`, {
            kind: "network",
            retryable: true,
            context: "embedding-download"
          })
        )
      }, CHECK_TIMEOUT_MS)
    })
    let stopRejectingOnAbort = () => {}
    const callerAbortPromise = new Promise<T>((_, reject) => {
      if (!signal) return
      const rejectOnAbort = () => reject(abortError(signal))
      if (signal.aborted) rejectOnAbort()
      else {
        signal.addEventListener("abort", rejectOnAbort, { once: true })
        stopRejectingOnAbort = () =>
          signal.removeEventListener("abort", rejectOnAbort)
      }
    })
    try {
      return await Promise.race([
        operation(controller.signal),
        timeoutPromise,
        callerAbortPromise
      ])
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      stopForwarding()
      stopRejectingOnAbort()
    }
  }

  const result = (
    status: "available" | "missing" | "unavailable" | "unverified",
    canDownload = false
  ) => ({
    exists: status === "available",
    status,
    canDownload
  })
  const checkOllama = async () => {
    const name = normalizeEmbeddingModelName(modelName)
    const baseUrl = await getOllamaBaseUrl()
    return withTimeout(async (operationSignal) => {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: operationSignal
      })
      if (!response.ok) return result("unavailable")
      const data = await response.json()
      if (!Array.isArray(data.models)) return result("unavailable")
      const tagged = (value: string) =>
        value.includes(":") ? value : `${value}:latest`
      const found = data.models.some(
        (model: { name?: string; model?: string }) =>
          tagged(model.name || model.model || "") === tagged(name)
      )
      return result(found ? "available" : "missing", !found)
    }, "Embedding model status check")
  }
  try {
    // Explicit provider identity always wins over a familiar model name.
    if (
      providerId === DEFAULT_PROVIDER_ID ||
      (!providerId &&
        normalizeEmbeddingModelName(modelName) === DEFAULT_EMBEDDING_MODEL)
    ) {
      return await checkOllama()
    }
    const { ProviderFactory } = await import("@/lib/providers/factory")
    let provider: LLMProvider
    try {
      provider = providerId
        ? await ProviderFactory.getProvider(providerId)
        : await ProviderFactory.getProviderForModel(modelName)
    } catch (error) {
      if (providerId) throw error
      return await checkOllama()
    }
    const discovery = await withTimeout(
      (operationSignal) => discoverProviderModels(provider, operationSignal),
      "Provider model list"
    )
    throwIfAborted(signal)
    if (discovery.catalog === "failed") return result("unavailable")
    if (discovery.catalog === "absent") return result("unverified")
    if ((provider.id || provider.config.id) === DEFAULT_PROVIDER_ID)
      return await checkOllama()
    const found = discovery.models.some((model) => model.name === modelName)
    return result(found ? "available" : "missing")
  } catch (error) {
    throwIfAborted(signal)
    logger.warn(
      "Embedding model status unavailable",
      "checkEmbeddingModelExists",
      { error }
    )
    return result("unavailable")
  }
}

/**
 * Downloads the embedding model silently (without UI feedback)
 * Used for auto-download on installation
 */
export const downloadEmbeddingModelSilently = async (
  modelName: string = DEFAULT_EMBEDDING_MODEL,
  signal?: AbortSignal
): Promise<{ success: boolean; error?: string }> => {
  // Declared here (armed only around the fetch below) so the catch can tell a
  // timeout from other errors without leaving a timer running on early returns.
  let downloadTimeout: AbortTimeout | undefined
  let stopForwarding = () => {}
  try {
    throwIfAborted(signal)
    const normalizedModelName = normalizeEmbeddingModelName(modelName)
    // Check if model already exists
    const result = await checkEmbeddingModelExists(
      normalizedModelName,
      DEFAULT_PROVIDER_ID,
      signal
    )
    if (result.exists) {
      logger.info(
        "Embedding model already exists",
        "downloadEmbeddingModelSilently",
        { modelName: normalizedModelName }
      )
      await setPlasmoStoredValue(STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED, true)
      return { success: true }
    }

    if (!result.canDownload)
      return {
        success: false,
        error:
          "Embedding model availability could not be confirmed. Check the provider connection."
      }

    const baseUrl = await getOllamaBaseUrl()
    const requestBody: DefaultProviderPullRequest = {
      name: normalizedModelName,
      stream: false // Don't stream for silent download
    }

    // Non-streaming pull holds the connection until the whole model downloads;
    // cap it so a hung provider can't keep the request (and SW) alive forever.
    const controller = new AbortController()
    stopForwarding = forwardAbort(signal, controller)
    downloadTimeout = createAbortTimeout(
      controller,
      EMBEDDING_DOWNLOAD_TIMEOUT_MS
    )
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    })
    downloadTimeout.clear()
    throwIfAborted(signal)

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

    await commitDownloadedEmbeddingModel(normalizedModelName, signal)

    logger.info(
      "Successfully downloaded embedding model",
      "downloadEmbeddingModelSilently",
      { modelName: normalizedModelName }
    )
    void notifyJobComplete({
      id: "embedding-model-download",
      title: "Embedding model ready",
      message: `${normalizedModelName} finished downloading - retrieval is ready to use.`
    })
    return { success: true }
  } catch (error) {
    throwIfAborted(signal)
    if (downloadTimeout?.timedOut()) {
      const message = `Embedding model download timed out after ${
        EMBEDDING_DOWNLOAD_TIMEOUT_MS / 60_000
      } minutes.`
      logger.error(message, "downloadEmbeddingModelSilently")
      return { success: false, error: message }
    }
    const errorMessage = getErrorMessage(error)
    logger.error(
      "Error downloading embedding model",
      "downloadEmbeddingModelSilently",
      { error: errorMessage }
    )
    return {
      success: false,
      error: errorMessage
    }
  } finally {
    downloadTimeout?.clear()
    stopForwarding()
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
  payload: PrepareEmbeddingPayload = {},
  signal?: AbortSignal
): Promise<{ ready: boolean; prepared: boolean; error?: string }> => {
  throwIfAborted(signal)
  const providerId = payload.providerId || DEFAULT_PROVIDER_ID
  const modelName = normalizeEmbeddingModelName(
    payload.model || DEFAULT_EMBEDDING_MODEL
  )

  // Only the default provider supports model pull in current runtime.
  if (providerId !== DEFAULT_PROVIDER_ID) {
    return { ready: true, prepared: false }
  }

  const existsResult = await checkEmbeddingModelExists(
    modelName,
    providerId,
    signal
  )
  if (existsResult.exists) {
    return { ready: true, prepared: false }
  }

  if (!existsResult.canDownload)
    return {
      ready: false,
      prepared: false,
      error:
        "Embedding model availability could not be confirmed. Check the provider connection."
    }

  const downloadResult = await downloadEmbeddingModelSilently(modelName, signal)
  if (downloadResult.success) {
    return { ready: true, prepared: true }
  }

  return {
    ready: false,
    prepared: false,
    error: downloadResult.error
  }
}
