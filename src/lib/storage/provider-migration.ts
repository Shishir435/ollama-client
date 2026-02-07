import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

type StorageLike = typeof plasmoGlobalStorage

const LEGACY_PROVIDER_MAPPINGS = [
  {
    legacyKey: LEGACY_STORAGE_KEYS.OLLAMA.BASE_URL,
    newKey: STORAGE_KEYS.PROVIDER.BASE_URL
  },
  {
    legacyKey: LEGACY_STORAGE_KEYS.OLLAMA.SELECTED_MODEL,
    newKey: STORAGE_KEYS.PROVIDER.SELECTED_MODEL
  },
  {
    legacyKey: LEGACY_STORAGE_KEYS.OLLAMA.PROMPT_TEMPLATES,
    newKey: STORAGE_KEYS.PROVIDER.PROMPT_TEMPLATES
  },
  {
    legacyKey: LEGACY_STORAGE_KEYS.OLLAMA.MODEL_CONFIGS,
    newKey: STORAGE_KEYS.PROVIDER.MODEL_CONFIGS
  }
]

export const migrateLegacyProviderStorage = async (
  storage: StorageLike = plasmoGlobalStorage
): Promise<{ migrated: boolean; migratedKeys: string[] }> => {
  const migratedKeys: string[] = []

  for (const mapping of LEGACY_PROVIDER_MAPPINGS) {
    const currentValue = await storage.get(mapping.newKey)
    if (
      currentValue !== undefined &&
      currentValue !== null &&
      currentValue !== ""
    ) {
      continue
    }

    const legacyValue = await storage.get(mapping.legacyKey)
    if (legacyValue !== undefined && legacyValue !== null) {
      await storage.set(mapping.newKey, legacyValue)
      migratedKeys.push(mapping.newKey)
    }
  }

  if (migratedKeys.length > 0) {
    logger.info("Migrated legacy provider storage keys", "ProviderStorage", {
      migratedKeys
    })
  }

  return {
    migrated: migratedKeys.length > 0,
    migratedKeys
  }
}
