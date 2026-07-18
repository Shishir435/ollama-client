import { createAppError } from "@/lib/error-utils"
import type {
  ProvidersListModelsRequest,
  ProvidersListModelsResult,
  ProvidersListResult,
  ProviderTestConnectionRequest,
  ProviderTestConnectionResult,
  PublicProviderConfig
} from "@/protocol/provider-rpc"
import type { ProviderModel } from "@/types/model"

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
    request: ProviderTestConnectionRequest
  ): Promise<ProviderTestConnectionResult> {
    const startedAt = performance.now()
    const provider =
      request.target === "draft"
        ? await ProviderFactory.getProviderWithConfig(
            request.config as ProviderConfig
          )
        : await ProviderFactory.getProvider(request.providerId)
    const models = await provider.getModels()
    return {
      providerId: String(provider.id),
      reachable: true,
      modelCount: models.length,
      latencyMs: Math.max(0, performance.now() - startedAt)
    }
  },

  async listModels(
    request: ProvidersListModelsRequest
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
          const discovered = await provider.getModels()
          models.push(...mergeProviderModels(discovered, config))
        } catch {
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
  }
}
