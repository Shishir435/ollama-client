import {
  getStoredModelConfig,
  modelConfigKey,
  resolveModelConfig
} from "@/lib/model-config-utils"
import type { ModelConfig } from "@/types"
import { getModelPreferences, updateModelPreference } from "./model-preferences"

/**
 * The stored (sparse) config for one model: its provider-scoped entry, or the
 * bare-name entry written before keys were scoped, minus reasoning effort —
 * which is provider-specific and never crosses that boundary.
 */
export const getStoredModelConfigFor = async (
  model: string,
  providerId?: string
): Promise<Partial<ModelConfig> | undefined> => {
  const keys = providerId ? [modelConfigKey(model, providerId), model] : [model]
  const entries = await getModelPreferences<Partial<ModelConfig>>(
    "config",
    keys
  )
  return getStoredModelConfig(entries, model, providerId)
}

/** The config a request runs with: stored fields over the defaults. */
export const getResolvedModelConfig = async (
  model: string,
  providerId?: string
): Promise<ModelConfig> =>
  resolveModelConfig(await getStoredModelConfigFor(model, providerId))

/**
 * Merge a change into one model's entry. A model with only a bare legacy
 * entry is promoted to its scoped key carrying those fields, as the sync map
 * did, so the first edit does not reset the rest.
 */
export const updateModelConfig = async (
  model: string,
  providerId: string | undefined,
  patch: Partial<ModelConfig>
): Promise<void> => {
  const inherited = await getStoredModelConfigFor(model, providerId)
  await updateModelPreference<Partial<ModelConfig>>(
    "config",
    modelConfigKey(model, providerId),
    (current) => ({ ...(current ?? inherited), ...patch })
  )
}
