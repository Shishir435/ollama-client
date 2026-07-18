import { browser } from "@/lib/browser-api"
import { DEFAULT_PROVIDER_ID, MESSAGE_KEYS } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { getProviderCapabilities } from "@/lib/providers/capabilities"
import { ProviderFactory } from "@/lib/providers/factory"
import { sendRuntimeMessage } from "@/lib/runtime-messages"
import type { ProviderModelDetails } from "@/types"

/**
 * `/api/show` can return large license, tensor, template, and Modelfile fields.
 * The model-detail panel and capability badges only consume these three, so we
 * strip the rest to keep the query cache (and any message payload) small.
 */
const compactModelDetails = (
  data: ProviderModelDetails | null
): ProviderModelDetails | null => {
  if (!data) return null
  return {
    ...(data.details && { details: data.details }),
    ...(data.model_info && { model_info: data.model_info }),
    ...(data.capabilities && { capabilities: data.capabilities })
  }
}

/**
 * Fetch model details directly in the page via the provider. Model discovery
 * uses the typed RPC boundary, while provider-specific detail lookup remains a
 * direct call until that optional capability joins the protocol.
 */
const fetchModelInfoInPage = async (
  model: string,
  providerId?: string
): Promise<{ data: ProviderModelDetails | null; supportsDetails: boolean }> => {
  const provider = await ProviderFactory.getProviderForModel(model, providerId)
  if (!provider.getModelDetails) {
    return { data: null, supportsDetails: false }
  }
  const data = await provider.getModelDetails(model)
  return { data: compactModelDetails(data), supportsDetails: true }
}

/**
 * Shared query function for every consumer of a model-info query key.
 * Failures throw so TanStack Query never caches a transport failure as `null`.
 */
export const fetchModelInfo = async (
  model: string,
  providerId?: string
): Promise<ProviderModelDetails | null> => {
  try {
    const { data, supportsDetails } = await fetchModelInfoInPage(
      model,
      providerId
    )
    if (data !== null || !supportsDetails) return data
    // A detail-capable provider returning null is unusual; fall through to the
    // worker before treating it as a hard, cacheable failure.
  } catch (error) {
    logger.debug(
      "In-page model-info fetch failed; falling back to background worker",
      "fetchModelInfo",
      { error }
    )
  }

  return fetchModelInfoViaWorker(model, providerId)
}

/** Fallback path: ask the background worker (older-worker / edge compatibility). */
const fetchModelInfoViaWorker = async (
  model: string,
  providerId?: string
): Promise<ProviderModelDetails | null> => {
  let response = await sendRuntimeMessage(
    MESSAGE_KEYS.PROVIDER.SHOW_MODEL_DETAILS,
    {
      payload: { model, providerId }
    }
  )

  // Compatibility for an already-open page talking to an older worker. Send the
  // structured `{ model, providerId }` payload (the handler accepts both shapes)
  // so the provider hint survives — otherwise a model name shared across
  // providers could resolve to the wrong one and the card would silently vanish.
  if (!response || (!response.success && !response.error)) {
    response = (await browser.runtime.sendMessage({
      type: MESSAGE_KEYS.PROVIDER.SHOW_MODEL_DETAILS,
      payload: { model, providerId }
    })) as typeof response
  }

  if (!response?.success) {
    throw createAppError(
      response?.error?.message || "Failed to fetch model info",
      {
        kind: "provider",
        cause: response?.error,
        providerId
      }
    )
  }

  const data = response.data ?? null
  if (data !== null) return data

  // `data` is null. Only treat that as a failure when a *trusted* provider is
  // known to support details: the worker's own `providerId` or the id the
  // client asked for. An older worker may resolve a bare/mapped model to a
  // non-Ollama provider and legitimately return null — guessing
  // DEFAULT_PROVIDER_ID (Ollama, `modelDetails: true`) would misreport that as a
  // retryable "no model info" error instead of the correct no-details state.
  const resolvedProviderId = response.providerId || providerId
  const supportsDetails =
    response.supportsDetails ??
    (resolvedProviderId
      ? Boolean(getProviderCapabilities(resolvedProviderId)?.modelDetails)
      : false)
  if (supportsDetails) {
    throw createAppError(`Provider returned no model info for ${model}`, {
      kind: "provider",
      providerId: resolvedProviderId ?? DEFAULT_PROVIDER_ID,
      retryable: true
    })
  }
  return null
}
