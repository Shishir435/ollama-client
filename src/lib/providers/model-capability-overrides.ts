import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ModelCapabilityOverride } from "./capabilities"

/**
 * Per-model capability overrides, persisted as a flat map keyed by
 * `${providerId}::${modelName}`. These let users declare capabilities a
 * provider cannot report on its own (vision, tool calling, etc.), so the
 * capability resolver can gate UI for those models. See `getModelCapabilities`
 * for how an override is layered on top of detection.
 */
export type ModelCapabilityOverrideMap = Record<string, ModelCapabilityOverride>

const STORAGE_KEY = STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES

export const modelCapabilityOverrideKey = (
  providerId: string,
  modelName: string
): string => `${providerId}::${modelName}`

export const getAllModelCapabilityOverrides =
  async (): Promise<ModelCapabilityOverrideMap> => {
    const stored =
      await plasmoGlobalStorage.get<ModelCapabilityOverrideMap>(STORAGE_KEY)
    return stored ?? {}
  }

export const getModelCapabilityOverride = async (
  providerId: string,
  modelName: string
): Promise<ModelCapabilityOverride | null> => {
  const all = await getAllModelCapabilityOverrides()
  return all[modelCapabilityOverrideKey(providerId, modelName)] ?? null
}

/**
 * Persist (or merge into) the override for a single model. Empty overrides are
 * removed so the map does not accumulate no-op entries.
 */
export const setModelCapabilityOverride = async (
  providerId: string,
  modelName: string,
  override: ModelCapabilityOverride
): Promise<void> => {
  const all = await getAllModelCapabilityOverrides()
  const key = modelCapabilityOverrideKey(providerId, modelName)

  const cleaned = pruneEmptyOverride(override)
  if (cleaned) {
    all[key] = cleaned
  } else {
    delete all[key]
  }

  await plasmoGlobalStorage.set(STORAGE_KEY, all)
}

export const clearModelCapabilityOverride = async (
  providerId: string,
  modelName: string
): Promise<void> => {
  const all = await getAllModelCapabilityOverrides()
  const key = modelCapabilityOverrideKey(providerId, modelName)
  if (key in all) {
    delete all[key]
    await plasmoGlobalStorage.set(STORAGE_KEY, all)
  }
}

/** Drop undefined fields; return null if nothing meaningful remains. */
const pruneEmptyOverride = (
  override: ModelCapabilityOverride
): ModelCapabilityOverride | null => {
  const entries = Object.entries(override).filter(
    ([, value]) => value !== undefined
  )
  return entries.length > 0
    ? (Object.fromEntries(entries) as ModelCapabilityOverride)
    : null
}
