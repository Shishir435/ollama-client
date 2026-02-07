import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import {
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
  }
]

/**
 * Manages persistence and retrieval of provider configurations.
 */
export const ProviderManager = {
  async getProviders(): Promise<ProviderConfig[]> {
    const stored = await plasmoGlobalStorage.get<ProviderConfig[]>(
      ProviderStorageKey.CONFIG
    )
    if (!stored || stored.length === 0) {
      await ProviderManager.saveProviders(DEFAULT_PROVIDERS)
      return DEFAULT_PROVIDERS
    }

    // Merge new defaults if they are missing from stored config
    const missing = DEFAULT_PROVIDERS.filter(
      (d) => !stored.find((s) => s.id === d.id)
    )
    if (missing.length > 0) {
      const merged = [...stored, ...missing]
      await ProviderManager.saveProviders(merged)
      return merged
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
   * Updates provider config and syncs legacy Ollama keys if needed.
   */
  async updateProviderConfig(
    id: string,
    updates: Partial<ProviderConfig>
  ): Promise<void> {
    const providers = await ProviderManager.getProviders()
    const index = providers.findIndex((p) => p.id === id)
    if (index !== -1) {
      const updatedConfig = { ...providers[index], ...updates }
      providers[index] = updatedConfig
      await ProviderManager.saveProviders(providers)

      if (id === ProviderId.OLLAMA && updates.baseUrl) {
        try {
          const { STORAGE_KEYS } = await import("@/lib/constants")
          await plasmoGlobalStorage.set(
            STORAGE_KEYS.OLLAMA.BASE_URL,
            updates.baseUrl
          )
        } catch (e) {
          console.warn("Failed to sync legacy Ollama URL", e)
        }
      }
    }
  },

  async getModelMapping(
    modelId: string
  ): Promise<{ providerId: string } | null> {
    const mappings = await plasmoGlobalStorage.get<Record<string, string>>(
      ProviderStorageKey.MODEL_MAPPINGS
    )
    if (!mappings || !mappings[modelId]) {
      return null
    }
    return { providerId: mappings[modelId] }
  },

  async setModelMapping(modelId: string, providerId: string): Promise<void> {
    const mappings =
      (await plasmoGlobalStorage.get<Record<string, string>>(
        ProviderStorageKey.MODEL_MAPPINGS
      )) || {}
    mappings[modelId] = providerId
    await plasmoGlobalStorage.set(ProviderStorageKey.MODEL_MAPPINGS, mappings)
  },

  async saveModelMappings(newMappings: Record<string, string>): Promise<void> {
    const mappings =
      (await plasmoGlobalStorage.get<Record<string, string>>(
        ProviderStorageKey.MODEL_MAPPINGS
      )) || {}
    const updated = { ...mappings, ...newMappings }
    await plasmoGlobalStorage.set(ProviderStorageKey.MODEL_MAPPINGS, updated)
  },

  async getEnabledProviders(): Promise<ProviderConfig[]> {
    const providers = await ProviderManager.getProviders()
    return providers.filter((p) => p.enabled)
  }
}
