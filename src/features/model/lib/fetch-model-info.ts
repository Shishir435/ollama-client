import { RpcMethod } from "@ollama-client/contracts/rpc"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { ProviderFactory } from "@/lib/providers/factory"
import { extensionRpcClient } from "@/protocol/extension-client"
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
  if (!provider.capabilities.modelDetails || !provider.getModelDetails) {
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

/**
 * Fallback path: ask the background worker over the typed RPC boundary.
 *
 * The result carries the provider the worker actually resolved to and whether
 * that provider can self-report details, so a `null` here is never guessed at:
 * a detail-capable provider returning nothing is a retryable failure, while a
 * provider without the capability is a settled "no details".
 */
const fetchModelInfoViaWorker = async (
  model: string,
  providerId?: string
): Promise<ProviderModelDetails | null> => {
  const result = await extensionRpcClient.call(RpcMethod.ModelsGetDetails, {
    model,
    ...(providerId && { providerId })
  })

  if (result.details !== null) return result.details
  if (result.supportsDetails) {
    throw createAppError(`Provider returned no model info for ${model}`, {
      kind: "provider",
      providerId: result.providerId || providerId || DEFAULT_PROVIDER_ID,
      retryable: true
    })
  }
  return null
}
