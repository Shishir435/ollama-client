import { useStorage } from "@plasmohq/storage/hook"
import { useCallback } from "react"

import { DEFAULT_PROVIDER_ID, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import {
  getModelCapabilities,
  getProviderCapabilities,
  type ModelCapabilities,
  type ModelCapabilityOverride
} from "@/lib/providers/capabilities"
import {
  clearModelCapabilityOverride,
  type ModelCapabilityOverrideMap,
  modelCapabilityOverrideKey,
  setModelCapabilityOverride
} from "@/lib/providers/model-capability-overrides"
import type { ProviderModel } from "@/types"

/**
 * Reactive access to per-model capability overrides plus a resolver that layers
 * them over provider/model detection. Reads go through `useStorage` so the UI
 * updates the moment an override is saved; writes go through the storage module
 * so the prune/merge rules stay in one place.
 */
export const useModelCapabilityOverrides = () => {
  const [overrides] = useStorage<ModelCapabilityOverrideMap>(
    {
      key: STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES,
      instance: plasmoGlobalStorage
    },
    {}
  )

  const getOverride = useCallback(
    (providerId: string, modelName: string): ModelCapabilityOverride | null =>
      overrides?.[modelCapabilityOverrideKey(providerId, modelName)] ?? null,
    [overrides]
  )

  const resolve = useCallback(
    (
      model: ProviderModel,
      ollamaCapabilities?: string[]
    ): ModelCapabilities => {
      const providerId = model.providerId || DEFAULT_PROVIDER_ID
      return getModelCapabilities({
        providerId,
        ollamaCapabilities,
        lmStudioModelType: model.capabilityHints?.modelType,
        contextLength: model.capabilityHints?.contextLength,
        override: getOverride(providerId, model.name)
      })
    },
    [getOverride]
  )

  /**
   * Whether a provider reports model-level capabilities on its own (Ollama).
   * Providers that cannot are the ones a user must configure by hand.
   */
  const canSelfReportCapabilities = useCallback(
    (providerId: string): boolean =>
      getProviderCapabilities(providerId)?.modelDetails === true,
    []
  )

  return {
    overrides: overrides ?? {},
    getOverride,
    resolve,
    canSelfReportCapabilities,
    setOverride: setModelCapabilityOverride,
    clearOverride: clearModelCapabilityOverride
  }
}
