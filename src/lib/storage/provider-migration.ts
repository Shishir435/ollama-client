import { z } from "zod"
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { ModelConfigMapSchema } from "@/lib/model-config-utils"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderStorageKey } from "@/lib/providers/types"
import { SelectedModelRefSchema } from "@/lib/storage/setting-schemas"
import { PromptTemplateSchema } from "@/types/ui-state.schemas"

type StorageLike = typeof plasmoGlobalStorage

const LEGACY_PROVIDER_MAPPINGS = [
  {
    legacyKey: LEGACY_STORAGE_KEYS.OLLAMA.SELECTED_MODEL,
    newKey: STORAGE_KEYS.PROVIDER.SELECTED_MODEL,
    schema: z.string().min(1)
  },
  {
    legacyKey: LEGACY_STORAGE_KEYS.OLLAMA.PROMPT_TEMPLATES,
    newKey: STORAGE_KEYS.PROVIDER.PROMPT_TEMPLATES,
    schema: z.array(PromptTemplateSchema)
  },
  {
    legacyKey: LEGACY_STORAGE_KEYS.OLLAMA.MODEL_CONFIGS,
    newKey: STORAGE_KEYS.PROVIDER.MODEL_CONFIGS,
    schema: ModelConfigMapSchema
  }
]

const ProviderMappingsSchema = z.record(z.string().min(1), z.string().min(1))

export const migrateLegacyProviderStorage = async (
  storage: StorageLike = plasmoGlobalStorage,
  signal?: AbortSignal
): Promise<{ migrated: boolean; migratedKeys: string[] }> => {
  const migratedKeys: string[] = []

  for (const mapping of LEGACY_PROVIDER_MAPPINGS) {
    signal?.throwIfAborted()
    const currentValue = await storage.get(mapping.newKey)
    signal?.throwIfAborted()
    if (mapping.schema.safeParse(currentValue).success) {
      continue
    }

    const legacyValue = await storage.get(mapping.legacyKey)
    signal?.throwIfAborted()
    const parsedLegacyValue = mapping.schema.safeParse(legacyValue)
    if (parsedLegacyValue.success) {
      await storage.set(mapping.newKey, parsedLegacyValue.data)
      migratedKeys.push(mapping.newKey)
    }
  }

  if (migratedKeys.length > 0) {
    logger.info("Migrated legacy provider storage keys", "ProviderStorage", {
      migratedKeys
    })
  }

  // Best-effort migration for selected model reference:
  // If we have legacy string selection + model mapping, create canonical ref.
  signal?.throwIfAborted()
  const selectedModelRef = await storage.get(
    STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF
  )
  signal?.throwIfAborted()
  const selectedModelRefResult =
    SelectedModelRefSchema.safeParse(selectedModelRef)
  if (!selectedModelRefResult.success || selectedModelRefResult.data === null) {
    const selectedModelValue = await storage.get<unknown>(
      STORAGE_KEYS.PROVIDER.SELECTED_MODEL
    )
    const selectedModelResult = z.string().min(1).safeParse(selectedModelValue)
    const selectedModel = selectedModelResult.success
      ? selectedModelResult.data
      : undefined
    signal?.throwIfAborted()
    const modelMappingsValue = await storage.get<unknown>(
      ProviderStorageKey.MODEL_MAPPINGS
    )
    const modelMappingsResult =
      ProviderMappingsSchema.safeParse(modelMappingsValue)
    const modelMappings = modelMappingsResult.success
      ? modelMappingsResult.data
      : undefined
    signal?.throwIfAborted()
    // The flat map may already have been migrated to scoped keys
    // (`providerId::modelName`) — check both shapes.
    const scopedMappingsValue = await storage.get<unknown>(
      ProviderStorageKey.MODEL_MAPPINGS_V2
    )
    const scopedMappingsResult =
      ProviderMappingsSchema.safeParse(scopedMappingsValue)
    const scopedMappings = scopedMappingsResult.success
      ? scopedMappingsResult.data
      : undefined
    signal?.throwIfAborted()
    // Parse the provider id out of the key itself (`providerId::modelName`)
    // rather than reconstructing the key from the entry's value — the two are
    // equivalent for well-formed rows, but key-parsing still resolves if a
    // row's value ever disagrees with its key.
    const scopedSuffix = `::${selectedModel}`
    const scopedKey = selectedModel
      ? Object.keys(scopedMappings ?? {}).find((key) =>
          key.endsWith(scopedSuffix)
        )
      : undefined
    const scopedProviderId = scopedKey
      ? scopedKey.slice(0, scopedKey.length - scopedSuffix.length)
      : undefined
    const mappedProviderId =
      (selectedModel ? modelMappings?.[selectedModel] : undefined) ??
      scopedProviderId
    if (selectedModel && mappedProviderId) {
      await storage.set(STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF, {
        providerId: mappedProviderId,
        modelId: selectedModel
      })
      signal?.throwIfAborted()
      await storage.remove(STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL)
      migratedKeys.push(STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF)
    }
  }

  return {
    migrated: migratedKeys.length > 0,
    migratedKeys
  }
}
