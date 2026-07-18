import { createAppError } from "@/lib/error-utils"
import type {
  ProvidersListModelsRequest,
  ProvidersListModelsResult,
  ProvidersListResult,
  ProvidersProbeModelCapabilitiesRequest,
  ProvidersProbeModelCapabilitiesResult,
  ProvidersRemoveRequest,
  ProvidersRemoveResult,
  ProvidersUpsertRequest,
  ProvidersUpsertResult,
  ProviderTestConnectionRequest,
  ProviderTestConnectionResult,
  PublicProviderConfig
} from "@/protocol/provider-rpc"
import type { ProviderModel } from "@/types/model"

import {
  probeReasoning,
  probeToolCalling,
  probeVision,
  setCapabilityProbe
} from "./capability-probe"
import { ProviderFactory } from "./factory"
import { ProviderManager } from "./manager"
import type { ProviderConfig } from "./types"

const toPublicConfig = (config: ProviderConfig): PublicProviderConfig => {
  const { apiKey, ...publicConfig } = config
  return {
    ...publicConfig,
    hasApiKey: Boolean(apiKey?.trim())
  }
}

const customModel = (name: string, config: ProviderConfig): ProviderModel => ({
  name,
  model: name,
  modified_at: new Date().toISOString(),
  size: 0,
  digest: String(config.id),
  providerId: String(config.id),
  providerName: config.name,
  details: {
    parent_model: "",
    format: "gguf",
    family: config.type,
    families: [],
    parameter_size: "",
    quantization_level: ""
  }
})

const mergeProviderModels = (
  models: ProviderModel[],
  config: ProviderConfig
): ProviderModel[] => {
  const byName = new Map(models.map((model) => [model.name, model]))
  for (const name of config.customModels ?? []) {
    if (!byName.has(name)) byName.set(name, customModel(name, config))
  }
  return [...byName.values()].map((model) => ({
    ...model,
    providerId: model.providerId || String(config.id),
    providerName: model.providerName || config.name
  }))
}

export const ProviderRpcService = {
  async list(): Promise<ProvidersListResult> {
    const providers = await ProviderManager.getProviders()
    return { providers: providers.map(toPublicConfig) }
  },

  async testConnection(
    request: ProviderTestConnectionRequest,
    signal?: AbortSignal
  ): Promise<ProviderTestConnectionResult> {
    const startedAt = performance.now()
    const provider =
      request.target === "draft"
        ? await (async () => {
            const draft = request.config as ProviderConfig
            const stored =
              draft.apiKey === undefined
                ? await ProviderManager.getProviderConfig(String(draft.id))
                : undefined
            return ProviderFactory.getProviderWithConfig({
              ...draft,
              ...(draft.apiKey === undefined && stored?.apiKey
                ? { apiKey: stored.apiKey }
                : {})
            })
          })()
        : await ProviderFactory.getProvider(request.providerId)
    const models = await provider.getModels(signal)
    return {
      providerId: String(provider.id),
      reachable: true,
      modelCount: models.length,
      latencyMs: Math.max(0, performance.now() - startedAt)
    }
  },

  async upsert(
    request: ProvidersUpsertRequest
  ): Promise<ProvidersUpsertResult> {
    if (request.target === "new") {
      const config = await ProviderManager.addCustomProvider(
        request.provider as Parameters<
          typeof ProviderManager.addCustomProvider
        >[0]
      )
      return { provider: toPublicConfig(config) }
    }

    const id = String(request.config.id)
    const existing = await ProviderManager.getProviderConfig(id)
    if (!existing) {
      throw createAppError(`Provider ${id} not found`, {
        kind: "provider",
        status: 404,
        providerId: id,
        userMessage: "Provider configuration was not found"
      })
    }
    if (request.config.type !== existing.type) {
      throw createAppError("A provider's wire protocol cannot be changed", {
        kind: "validation",
        status: 400,
        providerId: id,
        userMessage:
          "Provider protocol cannot be changed. Add a new provider instead."
      })
    }
    await ProviderManager.updateProviderConfig(
      id,
      request.config as ProviderConfig
    )
    const saved = await ProviderManager.getProviderConfig(id)
    if (!saved) {
      throw createAppError(`Provider ${id} disappeared after update`, {
        kind: "provider",
        status: 500,
        providerId: id,
        userMessage: "Provider configuration could not be saved"
      })
    }
    return { provider: toPublicConfig(saved) }
  },

  async remove(
    request: ProvidersRemoveRequest
  ): Promise<ProvidersRemoveResult> {
    await ProviderManager.removeCustomProvider(request.providerId)
    return { removedProviderId: request.providerId }
  },

  async listModels(
    request: ProvidersListModelsRequest,
    signal?: AbortSignal
  ): Promise<ProvidersListModelsResult> {
    const providers = await ProviderManager.getProviders()
    const selected = providers.filter((provider) => {
      if (request.providerId) {
        return String(provider.id) === request.providerId
      }
      return request.enabledOnly === false || provider.enabled
    })
    if (request.providerId && selected.length === 0) {
      throw createAppError(`Provider ${request.providerId} not found`, {
        kind: "provider",
        status: 404,
        providerId: request.providerId,
        userMessage: "Provider configuration was not found"
      })
    }

    const models: ProviderModel[] = []
    const failures: ProvidersListModelsResult["failures"] = []
    await Promise.all(
      selected.map(async (config) => {
        try {
          const provider = await ProviderFactory.getProvider(String(config.id))
          const discovered = await provider.getModels(signal)
          models.push(...mergeProviderModels(discovered, config))
        } catch (error) {
          if (signal?.aborted) throw error
          failures.push({
            providerId: String(config.id),
            code: "request_failed"
          })
        }
      })
    )

    if (selected.length > 0 && failures.length === selected.length) {
      throw createAppError(
        "Failed to fetch models from every selected provider",
        {
          kind: "provider",
          retryable: true,
          userMessage: "Failed to fetch models from the configured providers",
          debug: failures.map(({ providerId }) => providerId)
        }
      )
    }

    models.sort((left, right) => left.name.localeCompare(right.name))
    failures.sort((left, right) =>
      left.providerId.localeCompare(right.providerId)
    )
    return { models, failures }
  },

  async probeModelCapabilities(
    request: ProvidersProbeModelCapabilitiesRequest,
    signal?: AbortSignal
  ): Promise<ProvidersProbeModelCapabilitiesResult> {
    const provider = await ProviderFactory.getProvider(request.providerId)
    const [tool, reasoning, vision] = await Promise.allSettled([
      probeToolCalling(provider, request.modelName, signal),
      probeReasoning(provider, request.modelName, signal),
      probeVision(provider, request.modelName, signal)
    ])
    if (
      tool.status === "rejected" &&
      reasoning.status === "rejected" &&
      vision.status === "rejected"
    ) {
      throw tool.reason
    }

    const result: ProvidersProbeModelCapabilitiesResult = {
      probedAt: Date.now()
    }
    if (tool.status === "fulfilled") {
      result.toolCalling = tool.value.toolCalling
      result.toolCallingMode = tool.value.toolCallingMode
    }
    if (reasoning.status === "fulfilled") {
      result.reasoning = reasoning.value.reasoning
    }
    if (
      vision.status === "fulfilled" &&
      typeof vision.value.vision === "boolean"
    ) {
      result.vision = vision.value.vision
    }
    signal?.throwIfAborted()
    await setCapabilityProbe(request.providerId, request.modelName, result)
    return result
  }
}
