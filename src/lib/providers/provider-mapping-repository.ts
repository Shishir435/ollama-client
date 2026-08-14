import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { remapLegacyProviderId } from "./provider-compat-migration"
import { ProviderStorageKey } from "./types"

export const scopedModelKey = (providerId: string, modelId: string): string =>
  `${providerId}::${modelId}`

const readScopedModelMappings = async (): Promise<Record<string, string>> => {
  const v2 = await plasmoGlobalStorage.get<Record<string, string>>(
    ProviderStorageKey.MODEL_MAPPINGS_V2
  )
  if (v2) {
    const normalized: Record<string, string> = {}
    let changed = false
    for (const [key, providerId] of Object.entries(v2)) {
      const targetProviderId = remapLegacyProviderId(providerId)
      const separator = key.indexOf("::")
      const modelId = separator >= 0 ? key.slice(separator + 2) : key
      const targetKey = scopedModelKey(targetProviderId, modelId)
      normalized[targetKey] = targetProviderId
      if (targetKey !== key || targetProviderId !== providerId) changed = true
    }
    if (changed) {
      await plasmoGlobalStorage.set(
        ProviderStorageKey.MODEL_MAPPINGS_V2,
        normalized
      )
    }
    return normalized
  }

  const legacy = await plasmoGlobalStorage.get<Record<string, string>>(
    ProviderStorageKey.MODEL_MAPPINGS
  )
  const migrated: Record<string, string> = {}
  if (legacy) {
    for (const [modelId, providerId] of Object.entries(legacy)) {
      if (typeof providerId === "string" && providerId) {
        const targetProviderId = remapLegacyProviderId(providerId)
        migrated[scopedModelKey(targetProviderId, modelId)] = targetProviderId
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

export const getMappedProviderIds = async (
  modelId: string
): Promise<string[]> => {
  const mappings = await readScopedModelMappings()
  return Object.entries(mappings)
    .filter(([key, providerId]) => key === scopedModelKey(providerId, modelId))
    .map(([, providerId]) => providerId)
}

export const setModelMapping = async (
  modelId: string,
  providerId: string
): Promise<void> => {
  const mappings = await readScopedModelMappings()
  mappings[scopedModelKey(providerId, modelId)] = providerId
  await plasmoGlobalStorage.set(ProviderStorageKey.MODEL_MAPPINGS_V2, mappings)
}

export const removeModelMappingsForProvider = async (
  providerId: string
): Promise<void> => {
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
}
