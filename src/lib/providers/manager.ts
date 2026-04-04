import { LEGACY_STORAGE_KEYS } from "@/lib/constants"
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

const validateProviderBaseUrl = (baseUrl?: string): void => {
  if (!baseUrl) return
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error(`Invalid provider URL: ${baseUrl}`)
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP(S) provider URLs are supported")
  }

  if (parsed.username || parsed.password) {
    throw new Error("Provider URL must not include embedded credentials")
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

    // Merge new defaults if they are missing from stored config
    const missing = DEFAULT_PROVIDERS.filter(
      (d) => !stored.find((s) => s.id === d.id)
    )

    // Sync legacy provider URL if present (default provider legacy key)
    try {
      const legacyUrl = await plasmoGlobalStorage.get<string>(
        LEGACY_STORAGE_KEYS.OLLAMA.BASE_URL
      )

      const defaultProviderIndex = stored.findIndex(
        (p) => p.id === ProviderId.OLLAMA
      )
      if (
        defaultProviderIndex !== -1 &&
        legacyUrl &&
        legacyUrl !== stored[defaultProviderIndex].baseUrl
      ) {
        // Create a new array to avoid mutating the original if we are just reading
        stored = [...stored]
        stored[defaultProviderIndex] = {
          ...stored[defaultProviderIndex],
          baseUrl: legacyUrl
        }
        // We could save it back here, but maybe better to just use it in memory for now
        // to avoid side effects during read? No, syncing IS a side effect we want.
        // But let's keep getProviders pure-ish regarding persistence for now
        // and let updateProviderConfig handle writes.
        // Actually, if we Don't save it, the setting UI will show the old URL until saved.
        // But if we return the legacy URL, the UI will show it, and if user saves, it updates.
      }
    } catch (e) {
      console.warn("Failed to check legacy provider URL in getProviders", e)
    }

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
          const { LEGACY_STORAGE_KEYS } = await import("@/lib/constants")
          await plasmoGlobalStorage.set(
            LEGACY_STORAGE_KEYS.OLLAMA.BASE_URL,
            updates.baseUrl
          )
        } catch (e) {
          console.warn("Failed to sync legacy provider URL", e)
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
