import { LEGACY_STORAGE_KEYS } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import {
  type CustomProviderWire,
  isCustomProviderId,
  makeCustomProviderId,
  type ProviderConfig,
  ProviderId,
  ProviderStorageKey,
  ProviderType
} from "./types"

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: ProviderId.OLLAMA,
    type: ProviderType.OLLAMA,
    name: "Ollama",
    enabled: true,
    baseUrl: "http://localhost:11434"
  },
  {
    id: ProviderId.LM_STUDIO,
    type: ProviderType.OPENAI,
    name: "LM Studio",
    enabled: false,
    baseUrl: "http://localhost:1234/v1"
  },
  {
    id: ProviderId.LLAMA_CPP,
    type: ProviderType.OPENAI,
    name: "llama.cpp",
    enabled: false,
    baseUrl: "http://localhost:8000/v1"
  },
  {
    id: ProviderId.VLLM,
    type: ProviderType.OPENAI,
    name: "vLLM",
    enabled: false,
    baseUrl: "http://localhost:8001/v1"
  },
  {
    id: ProviderId.LOCALAI,
    type: ProviderType.OPENAI,
    name: "LocalAI",
    enabled: false,
    baseUrl: "http://localhost:8080/v1"
  },
  {
    id: ProviderId.KOBOLDCPP,
    type: ProviderType.OPENAI,
    name: "KoboldCpp",
    enabled: false,
    baseUrl: "http://localhost:5001/v1"
  }
]

const DEFAULT_PROVIDER_IDS = new Set(DEFAULT_PROVIDERS.map((p) => p.id))

// Built-in ids and user-added `custom:` ids survive; anything else is stale
// data from an old version and gets dropped.
const isKnownProviderId = (id: string): boolean =>
  DEFAULT_PROVIDER_IDS.has(id as ProviderId) || isCustomProviderId(id)

const sanitizeStoredProviders = (
  providers: ProviderConfig[]
): { providers: ProviderConfig[]; removed: ProviderConfig[] } => {
  return {
    providers: providers.filter((provider) =>
      isKnownProviderId(String(provider.id))
    ),
    removed: providers.filter(
      (provider) => !isKnownProviderId(String(provider.id))
    )
  }
}

export const scopedModelKey = (providerId: string, modelId: string): string =>
  `${providerId}::${modelId}`

/**
 * Read the scoped model→provider map, lazily migrating the legacy flat map
 * (`modelName → providerId`, collision-lossy) into scoped keys on first read.
 * The legacy key is deleted after migration so this branch runs once.
 */
const readScopedModelMappings = async (): Promise<Record<string, string>> => {
  const v2 = await plasmoGlobalStorage.get<Record<string, string>>(
    ProviderStorageKey.MODEL_MAPPINGS_V2
  )
  if (v2) return v2

  const legacy = await plasmoGlobalStorage.get<Record<string, string>>(
    ProviderStorageKey.MODEL_MAPPINGS
  )
  const migrated: Record<string, string> = {}
  if (legacy) {
    for (const [modelId, providerId] of Object.entries(legacy)) {
      if (typeof providerId === "string" && providerId) {
        migrated[scopedModelKey(providerId, modelId)] = providerId
      }
    }
    await plasmoGlobalStorage.set(
      ProviderStorageKey.MODEL_MAPPINGS_V2,
      migrated
    )
    await plasmoGlobalStorage.remove(ProviderStorageKey.MODEL_MAPPINGS)
    logger.info("Migrated model mappings to scoped keys", "ProviderManager", {
      count: Object.keys(migrated).length
    })
  } else {
    await plasmoGlobalStorage.set(
      ProviderStorageKey.MODEL_MAPPINGS_V2,
      migrated
    )
  }
  return migrated
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
    let stored = await plasmoGlobalStorage.get<ProviderConfig[]>(
      ProviderStorageKey.CONFIG
    )
    if (!stored || stored.length === 0) {
      await ProviderManager.saveProviders(DEFAULT_PROVIDERS)
      return DEFAULT_PROVIDERS
    }

    const sanitized = sanitizeStoredProviders(stored)
    if (sanitized.removed.length > 0) {
      logger.info(
        "Removed provider configs not present in the provider UI",
        "ProviderManager",
        {
          providers: sanitized.removed.map((provider) => provider.id)
        }
      )
      stored = sanitized.providers
    }

    // Merge new defaults if they are missing from stored config
    const currentStored = stored ?? []
    const missing = DEFAULT_PROVIDERS.filter(
      (d) => !currentStored.find((s) => s.id === d.id)
    )

    // One-time migration of the pre-provider-config Ollama base URL: adopt
    // it into the stored config, persist, and delete the legacy key so this
    // read stops happening on every getProviders call.
    try {
      const legacyUrl = await plasmoGlobalStorage.get<string>(
        LEGACY_STORAGE_KEYS.OLLAMA.BASE_URL
      )

      if (legacyUrl) {
        const defaultProviderIndex = stored.findIndex(
          (p) => p.id === ProviderId.OLLAMA
        )
        if (
          defaultProviderIndex !== -1 &&
          legacyUrl !== stored[defaultProviderIndex].baseUrl
        ) {
          stored = [...stored]
          stored[defaultProviderIndex] = {
            ...stored[defaultProviderIndex],
            baseUrl: legacyUrl
          }
          await ProviderManager.saveProviders(stored)
        }
        await plasmoGlobalStorage.remove(LEGACY_STORAGE_KEYS.OLLAMA.BASE_URL)
      }
    } catch (e) {
      logger.warn(
        "Failed to migrate legacy provider URL in getProviders",
        "ProviderManager",
        { error: e }
      )
    }

    if (missing.length > 0) {
      const merged = [...stored, ...missing]
      await ProviderManager.saveProviders(merged)
      return merged
    }

    if (sanitized.removed.length > 0) {
      await ProviderManager.saveProviders(stored)
    }

    return stored
  },

  async getProviderConfig(id: string): Promise<ProviderConfig | undefined> {
    const providers = await ProviderManager.getProviders()
    return providers.find((p) => p.id === id)
  },

  async saveProviders(providers: ProviderConfig[]): Promise<void> {
    await plasmoGlobalStorage.set(ProviderStorageKey.CONFIG, providers)
  },

  /**
   * Updates provider config and syncs legacy provider keys if needed.
   */
  async updateProviderConfig(
    id: string,
    updates: Partial<ProviderConfig>
  ): Promise<void> {
    const providers = await ProviderManager.getProviders()
    const index = providers.findIndex((p) => p.id === id)
    if (index !== -1) {
      if (updates.baseUrl !== undefined) {
        validateProviderBaseUrl(updates.baseUrl)
      }
      const updatedConfig = { ...providers[index], ...updates }
      providers[index] = updatedConfig
      await ProviderManager.saveProviders(providers)

      if (id === ProviderId.OLLAMA && updates.baseUrl) {
        try {
          await plasmoGlobalStorage.set(
            LEGACY_STORAGE_KEYS.OLLAMA.BASE_URL,
            updates.baseUrl
          )
        } catch (e) {
          logger.warn("Failed to sync legacy provider URL", "ProviderManager", {
            error: e
          })
        }
      }
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
    const mappings = await readScopedModelMappings()
    const candidates = Object.entries(mappings)
      .filter(
        ([key, providerId]) => key === scopedModelKey(providerId, modelId)
      )
      .map(([, providerId]) => providerId)
    if (candidates.length === 0) return null
    if (candidates.length === 1) return { providerId: candidates[0] }

    const providers = await ProviderManager.getProviders()
    const byConfigOrder = providers
      .filter((p) => candidates.includes(String(p.id)))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled))
    return { providerId: String(byConfigOrder[0]?.id ?? candidates[0]) }
  },

  async setModelMapping(modelId: string, providerId: string): Promise<void> {
    const mappings = await readScopedModelMappings()
    mappings[scopedModelKey(providerId, modelId)] = providerId
    await plasmoGlobalStorage.set(
      ProviderStorageKey.MODEL_MAPPINGS_V2,
      mappings
    )
  },

  /** Persist every (provider, model) pair — collisions are kept, not dropped. */
  async saveModelMappings(
    pairs: Array<{ modelId: string; providerId: string }>
  ): Promise<void> {
    if (pairs.length === 0) return
    const mappings = await readScopedModelMappings()
    for (const { modelId, providerId } of pairs) {
      mappings[scopedModelKey(providerId, modelId)] = providerId
    }
    await plasmoGlobalStorage.set(
      ProviderStorageKey.MODEL_MAPPINGS_V2,
      mappings
    )
  },

  /** All providers known to serve `modelId` (for disambiguation UI). */
  async getModelProviders(modelId: string): Promise<string[]> {
    const mappings = await readScopedModelMappings()
    return Object.entries(mappings)
      .filter(
        ([key, providerId]) => key === scopedModelKey(providerId, modelId)
      )
      .map(([, providerId]) => providerId)
  },

  /** Drop all mappings pointing at `providerId` (provider removed). */
  async removeModelMappingsForProvider(providerId: string): Promise<void> {
    const mappings = await readScopedModelMappings()
    let changed = false
    for (const [key, value] of Object.entries(mappings)) {
      if (value === providerId) {
        delete mappings[key]
        changed = true
      }
    }
    if (changed) {
      await plasmoGlobalStorage.set(
        ProviderStorageKey.MODEL_MAPPINGS_V2,
        mappings
      )
    }
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
  }): Promise<ProviderConfig> {
    const name = input.name.trim()
    if (!name) {
      throw createAppError("Provider name is required", { kind: "validation" })
    }
    validateProviderBaseUrl(input.baseUrl)

    const config: ProviderConfig = {
      id: makeCustomProviderId(input.wire),
      type: input.wire === "ollama" ? ProviderType.OLLAMA : ProviderType.OPENAI,
      name,
      enabled: true,
      baseUrl: input.baseUrl,
      ...(input.apiKey ? { apiKey: input.apiKey } : {})
    }

    const providers = await ProviderManager.getProviders()
    await ProviderManager.saveProviders([...providers, config])
    return config
  },

  /** Remove a custom provider and every per-model record scoped to it. */
  async removeCustomProvider(id: string): Promise<void> {
    if (!isCustomProviderId(id)) {
      throw createAppError("Built-in providers cannot be removed", {
        kind: "validation"
      })
    }
    const providers = await ProviderManager.getProviders()
    await ProviderManager.saveProviders(
      providers.filter((p) => String(p.id) !== id)
    )
    await ProviderManager.removeModelMappingsForProvider(id)
  },

  async getEnabledProviders(): Promise<ProviderConfig[]> {
    const providers = await ProviderManager.getProviders()
    return providers.filter((p) => p.enabled)
  }
}
