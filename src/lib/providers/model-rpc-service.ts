import type {
  ModelsGetDetailsRequest,
  ModelsGetDetailsResult,
  ModelsGetLibraryVariantsRequest,
  ModelsGetLibraryVariantsResult,
  ModelsListLoadedRequest,
  ModelsListLoadedResult,
  ModelsSearchLibraryRequest,
  ModelsSearchLibraryResult,
  ModelsUnloadRequest,
  ModelsUnloadResult,
  ModelsWarmupRequest,
  ModelsWarmupResult
} from "@ollama-client/contracts/model-rpc"
import { DEFAULT_MODEL_LIBRARY_BASE_URL } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  getStoredModelConfig,
  resolveModelConfig
} from "@/lib/model-config-utils"
import { ProviderFactory } from "@/lib/providers/factory"
import { ModelWarmupCache } from "@/lib/providers/model-warmup-cache"
import { assertProviderEnabled } from "@/lib/providers/provider-policy"
import { ProviderId } from "@/lib/providers/types"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import type { ProviderModelDetails } from "@/types"

/**
 * Background-owned model lifecycle and catalog operations behind the RPC
 * boundary, the counterpart to `ProviderRpcService` for provider config.
 *
 * Everything here used to live in `background/handlers/handle-*.ts` behind
 * untyped `MESSAGE_KEYS` messages. Errors are thrown as `AppError` so the RPC
 * server maps them to a code and a safe message; nothing here formats a
 * response envelope.
 */

const providerRequestFailed = (
  operation: string,
  status: number,
  statusText: string,
  providerId?: string
) =>
  createAppError(`${operation} failed with ${status}`, {
    kind: "provider",
    status,
    userMessage: statusText || `The provider rejected the ${operation} request`,
    providerId,
    retryable: status >= 500
  })

/**
 * `/api/show` may include large license, tensor, template, and Modelfile
 * fields. Only these three are consumed; keeping the rest out keeps the RPC
 * payload small and consistently serializable.
 */
const compactModelDetails = (
  data: ProviderModelDetails | null
): ModelsGetDetailsResult["details"] => {
  if (!data) return null
  return {
    ...(data.details && { details: data.details }),
    ...(data.model_info && { model_info: data.model_info }),
    ...(data.capabilities && { capabilities: data.capabilities })
  }
}

/** Warmup */

const warmupCache = new ModelWarmupCache()

const parseKeepAliveMs = (value?: string | number): number | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === "number") return Math.max(0, value) * 1000

  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 1000

  const match = trimmed.match(/^(\d+)(ms|s|m|h)$/i)
  if (!match) return undefined
  const amount = Number.parseInt(match[1], 10)
  if (Number.isNaN(amount) || amount < 0) return undefined
  const unit = match[2].toLowerCase()
  if (unit === "ms") return amount
  if (unit === "s") return amount * 1000
  if (unit === "m") return amount * 60 * 1000
  return amount * 60 * 60 * 1000
}

const getModelConfig = async (model: string, providerId?: string) => {
  const configs = await readSetting(SETTINGS.MODEL_CONFIGS)
  return resolveModelConfig(getStoredModelConfig(configs, model, providerId))
}

const buildWarmupKey = (model: string, providerId?: string) =>
  `${providerId || ProviderId.OLLAMA}:${model}`

export const ModelRpcService = {
  async getDetails(
    request: ModelsGetDetailsRequest
  ): Promise<ModelsGetDetailsResult> {
    const provider = await ProviderFactory.getProviderForModel(
      request.model,
      request.providerId
    )

    if (!provider.capabilities.modelDetails || !provider.getModelDetails) {
      // A legitimate "no details": the resolved provider cannot self-report.
      // Say so explicitly so the caller does not read null as a failure.
      return { providerId: provider.id, supportsDetails: false, details: null }
    }

    return {
      providerId: provider.id,
      supportsDetails: true,
      details: compactModelDetails(
        await provider.getModelDetails(request.model)
      )
    }
  },

  async listLoaded(
    request: ModelsListLoadedRequest,
    signal?: AbortSignal
  ): Promise<ModelsListLoadedResult> {
    const provider = await ProviderFactory.getProvider(
      request.providerId ?? ProviderId.OLLAMA
    )
    const listLoadedModels = provider.modelLifecycle?.listLoadedModels
    return { models: listLoadedModels ? await listLoadedModels(signal) : [] }
  },

  async unload(
    request: ModelsUnloadRequest,
    signal?: AbortSignal
  ): Promise<ModelsUnloadResult> {
    const provider = await ProviderFactory.getProviderForModel(
      request.model,
      request.providerId
    )
    const unloadModel = provider.modelLifecycle?.unloadModel
    if (!provider.capabilities.modelUnload || !unloadModel) {
      return { unloaded: false }
    }
    return { unloaded: await unloadModel(request.model, signal) }
  },

  async warmup(
    request: ModelsWarmupRequest,
    signal?: AbortSignal
  ): Promise<ModelsWarmupResult> {
    const config = await getModelConfig(request.model, request.providerId)
    const keepAliveMs = parseKeepAliveMs(config.keep_alive)
    const warmupKey = buildWarmupKey(request.model, request.providerId)

    let warmed = false
    if (
      config.warm_on_select &&
      warmupCache.shouldWarmup(warmupKey, keepAliveMs)
    ) {
      const provider = await ProviderFactory.getProviderForModel(
        request.model,
        request.providerId
      )
      assertProviderEnabled(provider, request.model)
      const warmModel = provider.modelLifecycle?.warmModel
      if (warmModel) {
        await warmModel(request.model, config.keep_alive, signal)
        warmupCache.record(warmupKey, keepAliveMs)
        warmed = true
        logger.info("Model warmup triggered", "ModelRpcService", {
          model: request.model
        })
      }
    }

    let unloadedPrevious = false
    if (request.previousModel && request.previousModel !== request.model) {
      const previousConfig = await getModelConfig(
        request.previousModel,
        request.previousProviderId
      )
      if (previousConfig.unload_on_switch) {
        const previous = await ProviderFactory.getProviderForModel(
          request.previousModel,
          request.previousProviderId
        )
        const unloadModel = previous.modelLifecycle?.unloadModel
        if (previous.capabilities.modelUnload && unloadModel) {
          unloadedPrevious = await unloadModel(request.previousModel, signal)
          logger.info("Model unloaded on switch", "ModelRpcService", {
            model: request.previousModel
          })
        }
      }
    }

    return { warmed, unloadedPrevious }
  },

  async searchLibrary(
    request: ModelsSearchLibraryRequest,
    signal?: AbortSignal
  ): Promise<ModelsSearchLibraryResult> {
    const res = await fetch(
      `${DEFAULT_MODEL_LIBRARY_BASE_URL}/search?q=${encodeURIComponent(request.query)}`,
      { signal }
    )
    if (!res.ok) {
      throw providerRequestFailed("model search", res.status, res.statusText)
    }
    return { html: await res.text() }
  },

  async getLibraryVariants(
    request: ModelsGetLibraryVariantsRequest,
    signal?: AbortSignal
  ): Promise<ModelsGetLibraryVariantsResult> {
    const res = await fetch(
      `${DEFAULT_MODEL_LIBRARY_BASE_URL}/library/${encodeURIComponent(request.name)}`,
      { signal }
    )
    if (!res.ok) {
      throw providerRequestFailed("model variants", res.status, res.statusText)
    }
    return { html: await res.text() }
  }
}
