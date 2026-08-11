import type {
  LoadedModel,
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
import { DEFAULT_MODEL_LIBRARY_BASE_URL, STORAGE_KEYS } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  parseStoredModelConfigMap,
  resolveModelConfig
} from "@/lib/model-config-utils"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderManager } from "@/lib/providers/manager"
import { assertProviderEnabled } from "@/lib/providers/provider-policy"
import { ProviderId } from "@/lib/providers/types"
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

const resolveDefaultBaseUrl = async (): Promise<string> => {
  const config = await ProviderManager.getProviderConfig(ProviderId.OLLAMA)
  if (!config) {
    throw createAppError("Built-in Ollama provider configuration is missing", {
      kind: "validation",
      providerId: ProviderId.OLLAMA
    })
  }
  return resolveProviderBaseUrl(config)
}

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

const lmStudioRoot = (baseUrl: string) => baseUrl.replace(/\/v1\/?$/, "")

/** Ollama `/api/ps` entry. */
interface OllamaPsModel {
  name?: string
  model?: string
  size?: number
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

/** LM Studio model-list entry; field names differ from Ollama's. */
interface LmStudioModel {
  id?: string
  arch?: string
  quantization?: string
  state?: string
}

const normalizeOllamaLoaded = (model: OllamaPsModel): LoadedModel => ({
  name: model.name ?? model.model ?? "",
  sizeBytes: model.size ?? 0,
  family: model.details?.family ?? "",
  parameterSize: model.details?.parameter_size ?? "",
  quantizationLevel: model.details?.quantization_level ?? ""
})

const normalizeLmStudioLoaded = (model: LmStudioModel): LoadedModel => ({
  name: model.id ?? "",
  // LM Studio's list does not report resident bytes.
  sizeBytes: 0,
  family: model.arch ?? "",
  parameterSize: "",
  quantizationLevel: model.quantization ?? ""
})

/** Warmup */

const warmupHistory = new Map<string, number>()

const DEFAULT_WARMUP_COOLDOWN_MS = 5 * 60 * 1000

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

const getModelConfig = async (model: string) => {
  const configs = parseStoredModelConfigMap(
    await plasmoGlobalStorage.get<unknown>(STORAGE_KEYS.PROVIDER.MODEL_CONFIGS)
  )
  return resolveModelConfig(configs[model])
}

const buildWarmupKey = (model: string, providerId?: string) =>
  `${providerId || ProviderId.OLLAMA}:${model}`

const shouldWarmup = (historyKey: string, keepAliveMs?: number) => {
  if (keepAliveMs === 0) return false
  const last = warmupHistory.get(historyKey)
  if (!last) return true
  const windowMs = keepAliveMs ?? DEFAULT_WARMUP_COOLDOWN_MS
  return Date.now() - last > windowMs / 2
}

/**
 * Keep-alive 0 evicts the model. Used both to warm the newly selected model and
 * to release the one being switched away from.
 */
const unloadViaKeepAlive = async (
  baseUrl: string,
  model: string,
  signal?: AbortSignal
) =>
  fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
    signal
  })

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
    const baseUrl = request.providerId
      ? resolveProviderBaseUrl(provider.config)
      : await resolveDefaultBaseUrl()

    const isLmStudio = provider.id === ProviderId.LM_STUDIO
    const endpoint = isLmStudio
      ? `${lmStudioRoot(baseUrl)}/api/v1/models`
      : `${baseUrl}/api/ps`

    const res = await fetch(endpoint, { signal })
    if (!res.ok) {
      throw providerRequestFailed(
        "loaded model list",
        res.status,
        res.statusText,
        provider.id
      )
    }

    const data = await res.json()
    if (isLmStudio) {
      const models: LmStudioModel[] = Array.isArray(data?.data) ? data.data : []
      return { models: models.map(normalizeLmStudioLoaded) }
    }
    const models: OllamaPsModel[] = Array.isArray(data?.models)
      ? data.models
      : []
    return { models: models.map(normalizeOllamaLoaded) }
  },

  async unload(
    request: ModelsUnloadRequest,
    signal?: AbortSignal
  ): Promise<ModelsUnloadResult> {
    const provider = await ProviderFactory.getProviderForModel(
      request.model,
      request.providerId
    )
    const baseUrl = resolveProviderBaseUrl(provider.config)

    if (provider.id === ProviderId.LM_STUDIO) {
      const res = await fetch(`${lmStudioRoot(baseUrl)}/api/v1/models/unload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: request.model }),
        signal
      })
      if (!res.ok) {
        throw providerRequestFailed(
          "unload",
          res.status,
          res.statusText,
          provider.id
        )
      }
      return { unloaded: true }
    }

    const res = await unloadViaKeepAlive(baseUrl, request.model, signal)
    if (!res.ok) {
      throw providerRequestFailed(
        "unload",
        res.status,
        res.statusText,
        provider.id
      )
    }
    const data = await res.json()
    return { unloaded: data?.done_reason === "unload" }
  },

  async warmup(
    request: ModelsWarmupRequest,
    signal?: AbortSignal
  ): Promise<ModelsWarmupResult> {
    const config = await getModelConfig(request.model)
    const keepAliveMs = parseKeepAliveMs(config.keep_alive)
    const warmupKey = buildWarmupKey(request.model, request.providerId)

    let warmed = false
    if (config.warm_on_select && shouldWarmup(warmupKey, keepAliveMs)) {
      const provider = await ProviderFactory.getProviderForModel(
        request.model,
        request.providerId
      )
      assertProviderEnabled(provider, request.model)
      // Only Ollama exposes a no-op generate that parks a model in memory.
      if (provider.id === ProviderId.OLLAMA) {
        await fetch(`${resolveProviderBaseUrl(provider.config)}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: request.model,
            prompt: "",
            stream: false,
            keep_alive: config.keep_alive
          }),
          signal
        })
        warmupHistory.set(warmupKey, Date.now())
        warmed = true
        logger.info("Model warmup triggered", "ModelRpcService", {
          model: request.model
        })
      }
    }

    let unloadedPrevious = false
    if (request.previousModel && request.previousModel !== request.model) {
      const previousConfig = await getModelConfig(request.previousModel)
      if (previousConfig.unload_on_switch) {
        const previous = await ProviderFactory.getProviderForModel(
          request.previousModel,
          request.previousProviderId
        )
        if (previous.id === ProviderId.OLLAMA) {
          await unloadViaKeepAlive(
            resolveProviderBaseUrl(previous.config),
            request.previousModel,
            signal
          )
          unloadedPrevious = true
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
