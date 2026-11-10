import {
  deleteModelPreferencesWithPrefix,
  getModelPreferences,
  listModelPreferences,
  updateModelPreference
} from "@/lib/repositories/model-preferences"
import type { ModelCapabilityOverride } from "./capabilities"

/**
 * Per-model capability overrides, one `model_preferences` row each, keyed by
 * `${providerId}::${modelName}`. Writes are per-row transactions, so two
 * contexts editing different models cannot clobber each other. These let users declare capabilities a
 * provider cannot report on its own (vision, tool calling, etc.), so the
 * capability resolver can gate UI for those models. See `getModelCapabilities`
 * for how an override is layered on top of detection.
 */
export type ModelCapabilityOverrideMap = Record<string, ModelCapabilityOverride>

export const modelCapabilityOverrideKey = (
  providerId: string,
  modelName: string
): string => `${providerId}::${modelName}`

export const getAllModelCapabilityOverrides =
  (): Promise<ModelCapabilityOverrideMap> =>
    listModelPreferences<ModelCapabilityOverride>("capabilities")

export const getModelCapabilityOverride = async (
  providerId: string,
  modelName: string
): Promise<ModelCapabilityOverride | null> => {
  const key = modelCapabilityOverrideKey(providerId, modelName)
  const found = await getModelPreferences<ModelCapabilityOverride>(
    "capabilities",
    [key]
  )
  return found[key] ?? null
}

/**
 * Persist the override for a single model. Empty overrides are removed so the
 * table does not accumulate no-op rows.
 */
export const setModelCapabilityOverride = (
  providerId: string,
  modelName: string,
  override: ModelCapabilityOverride
): Promise<void> =>
  updateModelPreference<ModelCapabilityOverride>(
    "capabilities",
    modelCapabilityOverrideKey(providerId, modelName),
    () => pruneEmptyOverride(override)
  )

export const clearModelCapabilityOverride = (
  providerId: string,
  modelName: string
): Promise<void> =>
  updateModelPreference<ModelCapabilityOverride>(
    "capabilities",
    modelCapabilityOverrideKey(providerId, modelName),
    () => null
  )

/** Drop every override scoped to a provider (provider removed). */
export const clearModelCapabilityOverridesForProvider = (
  providerId: string
): Promise<void> =>
  deleteModelPreferencesWithPrefix("capabilities", `${providerId}::`)

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
