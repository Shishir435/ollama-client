import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { clearCapabilityProbesForProvider } from "./capability-probe"
import { clearModelCapabilityOverridesForProvider } from "./model-capability-overrides"
import { clearModelCatalogSupport } from "./model-catalog-support"
import { getProviderConfigsUnlocked } from "./provider-config-repository"
import {
  removeModelMappingsForProvider as deleteModelMappingsForProvider,
  getMappedProviderIds,
  setModelMapping as persistModelMapping
} from "./provider-mapping-repository"
import {
  persistProviderConfigs,
  persistProviderConfigsUnlocked,
  withProviderPersistenceLock
} from "./provider-secret-store"
import {
  providerProfileRequiresApiKey,
  resolveProviderServiceProfile
} from "./service-profile"
import {
  type CustomProviderWire,
  isCustomProviderId,
  makeCustomProviderId,
  type ProviderConfig,
  ProviderServiceProfile,
  ProviderType
} from "./types"

export { DEFAULT_PROVIDERS } from "./provider-defaults"
export { scopedModelKey } from "./provider-mapping-repository"

const validateHostedProfileConfig = (config: ProviderConfig): void => {
  const profile = resolveProviderServiceProfile(config)
  if (providerProfileRequiresApiKey(profile) && !config.apiKey?.trim()) {
    throw createAppError("An API key is required for this provider", {
      kind: "validation"
    })
  }

  if (
    (profile === ProviderServiceProfile.OPENAI ||
      profile === ProviderServiceProfile.OPENROUTER) &&
    config.type !== ProviderType.OPENAI
  ) {
    throw createAppError(
      `${profile === ProviderServiceProfile.OPENROUTER ? "OpenRouter" : "OpenAI"} requires the OpenAI-compatible wire`,
      { kind: "validation" }
    )
  }
  if (
    profile === ProviderServiceProfile.ANTHROPIC &&
    config.type !== ProviderType.ANTHROPIC
  ) {
    throw createAppError("Anthropic requires the Anthropic Messages wire", {
      kind: "validation"
    })
  }
}

const validateProviderBaseUrl = (baseUrl?: string): void => {
  if (!baseUrl) return
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw createAppError(`Invalid provider URL: ${baseUrl}`, {
      kind: "validation"
    })
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw createAppError("Only HTTP(S) provider URLs are supported", {
      kind: "validation"
    })
  }

  if (parsed.username || parsed.password) {
    throw createAppError("Provider URL must not include embedded credentials", {
      kind: "validation"
    })
  }
}

/**
 * Manages persistence and retrieval of provider configurations.
 */
export const ProviderManager = {
  async getProviders(): Promise<ProviderConfig[]> {
    return withProviderPersistenceLock(getProviderConfigsUnlocked)
  },

  async getProviderConfig(id: string): Promise<ProviderConfig | undefined> {
    const providers = await ProviderManager.getProviders()
    return providers.find((p) => p.id === id)
  },

  async saveProviders(providers: ProviderConfig[]): Promise<void> {
    await persistProviderConfigs(providers)
  },

  /**
   * Updates provider config and syncs legacy provider keys if needed.
   */
  async updateProviderConfig(
    id: string,
    updates: Partial<ProviderConfig>
  ): Promise<void> {
    if (updates.baseUrl !== undefined) {
      validateProviderBaseUrl(updates.baseUrl)
    }
    let previousBaseUrl: string | undefined
    let updated = false

    await withProviderPersistenceLock(async () => {
      const providers = await getProviderConfigsUnlocked()
      const index = providers.findIndex((p) => p.id === id)
      if (index === -1) return

      previousBaseUrl = providers[index].baseUrl
      const nextConfig = { ...providers[index], ...updates }
      validateHostedProfileConfig(nextConfig)
      providers[index] = nextConfig
      await persistProviderConfigsUnlocked(providers)
      updated = true
    })

    // A different endpoint may be a different server — probe results no
    // longer describe it.
    if (
      updated &&
      updates.baseUrl !== undefined &&
      updates.baseUrl !== previousBaseUrl
    ) {
      await clearCapabilityProbesForProvider(id).catch((e) => {
        logger.warn("Failed to clear capability probes", "ProviderManager", {
          error: e
        })
      })
    }
  },

  /**
   * Resolve the provider serving `modelId`. The stored map is keyed
   * `providerId::modelName` so two providers serving the same model name both
   * keep their entry (the legacy flat map silently dropped one). Bare-name
   * lookups — callers that don't have a provider ref — resolve ambiguity by
   * enabled-provider order in the user's config, so routing is deterministic.
   */
  async getModelMapping(
    modelId: string
  ): Promise<{ providerId: string } | null> {
    const candidates = await getMappedProviderIds(modelId)
    if (candidates.length === 0) return null
    if (candidates.length === 1) return { providerId: candidates[0] }

    const providers = await ProviderManager.getProviders()
    const byConfigOrder = providers
      .filter((p) => candidates.includes(String(p.id)))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled))
    return { providerId: String(byConfigOrder[0]?.id ?? candidates[0]) }
  },

  async setModelMapping(modelId: string, providerId: string): Promise<void> {
    await persistModelMapping(modelId, providerId)
  },

  /** All providers known to serve `modelId` (for disambiguation UI). */
  async getModelProviders(modelId: string): Promise<string[]> {
    return getMappedProviderIds(modelId)
  },

  /** Drop all mappings pointing at `providerId` (provider removed). */
  async removeModelMappingsForProvider(providerId: string): Promise<void> {
    await deleteModelMappingsForProvider(providerId)
  },

  /**
   * Add a user-defined provider. The wire protocol is baked into the generated
   * id (`custom:<wire>:<rand>`), so factory/capability resolution never needs
   * the stored config. Returns the persisted config.
   */
  async addCustomProvider(input: {
    name: string
    baseUrl: string
    wire: CustomProviderWire
    apiKey?: string
    customModels?: string[]
    serviceProfile?: ProviderServiceProfile
  }): Promise<ProviderConfig> {
    const name = input.name.trim()
    if (!name) {
      throw createAppError("Provider name is required", { kind: "validation" })
    }
    validateProviderBaseUrl(input.baseUrl)
    const type =
      input.wire === "ollama"
        ? ProviderType.OLLAMA
        : input.wire === "anthropic"
          ? ProviderType.ANTHROPIC
          : ProviderType.OPENAI

    let config: ProviderConfig = {
      id: makeCustomProviderId(input.wire),
      type,
      name,
      enabled: true,
      baseUrl: input.baseUrl,
      ...(input.serviceProfile ? { serviceProfile: input.serviceProfile } : {}),
      ...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
      ...(input.customModels?.length
        ? {
            customModels: [
              ...new Set(
                input.customModels.map((model) => model.trim()).filter(Boolean)
              )
            ]
          }
        : {})
    }
    validateHostedProfileConfig(config)

    await withProviderPersistenceLock(async () => {
      const providers = await getProviderConfigsUnlocked()
      /*
       * The suffix carries 32 bits, so a collision is vanishingly unlikely —
       * but unlikely is not a guarantee, and the failure mode is bad out of
       * proportion to the odds: an id that already exists produces a provider
       * the user configured and cannot reach, or one that silently replaces
       * another during the next sanitize. Checked against the same snapshot
       * that gets persisted, inside the lock, so a concurrent add cannot slip
       * between the check and the write.
       */
      const taken = new Set(providers.map((provider) => String(provider.id)))
      for (let attempt = 0; taken.has(String(config.id)); attempt += 1) {
        if (attempt >= 8) {
          throw createAppError("Could not allocate a unique provider id", {
            kind: "validation"
          })
        }
        config = { ...config, id: makeCustomProviderId(input.wire) }
      }
      await persistProviderConfigsUnlocked([...providers, config])
    })
    return config
  },

  /** Remove a custom provider and every per-model record scoped to it. */
  async removeCustomProvider(id: string): Promise<void> {
    if (!isCustomProviderId(id)) {
      throw createAppError("Built-in providers cannot be removed", {
        kind: "validation"
      })
    }
    await withProviderPersistenceLock(async () => {
      const providers = await getProviderConfigsUnlocked()
      await persistProviderConfigsUnlocked(
        providers.filter((p) => String(p.id) !== id)
      )
    })
    await ProviderManager.removeModelMappingsForProvider(id)
    await clearCapabilityProbesForProvider(id).catch(() => undefined)
    await clearModelCapabilityOverridesForProvider(id).catch(() => undefined)
    await clearModelCatalogSupport(id).catch(() => undefined)
  },

  async getEnabledProviders(): Promise<ProviderConfig[]> {
    const providers = await ProviderManager.getProviders()
    return providers.filter((p) => p.enabled)
  }
}
