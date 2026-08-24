import { useCallback } from "react"

import { useSetting } from "@/hooks/use-setting"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import {
  getModelCapabilities,
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
import { POLICY_SETTINGS } from "@/lib/storage/policy-settings"
import type { ProviderModel } from "@/types"

/**
 * Reactive access to per-model capability overrides plus a resolver that layers
 * them over provider/model detection. Reads go through `useStorage` so the UI
 * updates the moment an override is saved; writes go through the storage module
 * so the prune/merge rules stay in one place.
 */
export const useModelCapabilityOverrides = () => {
  const [overrides] = useSetting(POLICY_SETTINGS.MODEL_CAPABILITY_OVERRIDES)
  const [probes] = useSetting(POLICY_SETTINGS.MODEL_CAPABILITY_PROBES)

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
        capabilityTags: model.capabilityHints?.capabilityTags,
        contextLength: model.capabilityHints?.contextLength,
        modalities: model.capabilityHints?.modalities,
        outputModalities: model.capabilityHints?.outputModalities,
        supportedParameters: model.capabilityHints?.supportedParameters,
        override: getOverride(providerId, model.name),
        probed: getProbe(providerId, model.name)
      })
    },
    [getOverride, getProbe]
  )

  return {
    overrides: overrides ?? {},
    getOverride,
    getProbe,
    resolve,
    setOverride: setModelCapabilityOverride,
    clearOverride: clearModelCapabilityOverride
  }
}
