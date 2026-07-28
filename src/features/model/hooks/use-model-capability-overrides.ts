import { useCallback } from "react"

import { useSetting } from "@/hooks/use-setting"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import {
  getModelCapabilities,
  getProviderCapabilities,
  type ModelCapabilities,
  type ModelCapabilityOverride
} from "@/lib/providers/capabilities"
import {
  type CapabilityProbeResult,
  capabilityProbeKey
} from "@/lib/providers/capability-probe"
import {
  clearModelCapabilityOverride,
  modelCapabilityOverrideKey,
  setModelCapabilityOverride
} from "@/lib/providers/model-capability-overrides"
import { SETTINGS } from "@/lib/storage/settings"
import type { ProviderModel } from "@/types"

/**
 * Reactive access to per-model capability overrides plus a resolver that layers
 * them over provider/model detection. Reads go through `useStorage` so the UI
 * updates the moment an override is saved; writes go through the storage module
 * so the prune/merge rules stay in one place.
 */
export const useModelCapabilityOverrides = () => {
  const [overrides] = useSetting(SETTINGS.MODEL_CAPABILITY_OVERRIDES)
  const [probes] = useSetting(SETTINGS.MODEL_CAPABILITY_PROBES)

  const getOverride = useCallback(
    (providerId: string, modelName: string): ModelCapabilityOverride | null =>
      overrides?.[modelCapabilityOverrideKey(providerId, modelName)] ?? null,
    [overrides]
  )

  const getProbe = useCallback(
    (providerId: string, modelName: string): CapabilityProbeResult | null =>
      probes?.[capabilityProbeKey(providerId, modelName)] ?? null,
    [probes]
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
        modalities: model.capabilityHints?.modalities,
        supportedParameters: model.capabilityHints?.supportedParameters,
        override: getOverride(providerId, model.name),
        probed: getProbe(providerId, model.name)
      })
    },
    [getOverride, getProbe]
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
    getProbe,
    resolve,
    canSelfReportCapabilities,
    setOverride: setModelCapabilityOverride,
    clearOverride: clearModelCapabilityOverride
  }
}
