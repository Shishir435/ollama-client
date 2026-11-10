import { useCallback, useEffect, useState } from "react"
import { useSetting } from "@/hooks/use-setting"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { logger } from "@/lib/logger"
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
  getAllModelCapabilityOverrides,
  type ModelCapabilityOverrideMap,
  modelCapabilityOverrideKey,
  setModelCapabilityOverride
} from "@/lib/providers/model-capability-overrides"
import { subscribeModelPreferences } from "@/lib/repositories/model-preferences"
import { POLICY_SETTINGS } from "@/lib/storage/policy-settings"
import type { ProviderModel } from "@/types"

/**
 * Reactive access to per-model capability overrides plus a resolver that layers
 * them over provider/model detection. Overrides re-read on every change
 * notification, from any extension page, so the UI updates the moment one is
 * saved; writes go through the override module so the prune rules stay in one
 * place.
 */
export const useModelCapabilityOverrides = () => {
  const [overrides, setOverrides] = useState<ModelCapabilityOverrideMap>({})
  useEffect(() => {
    let active = true
    const load = () => {
      void getAllModelCapabilityOverrides()
        .then((next) => {
          if (active) setOverrides(next)
        })
        .catch((error) => {
          logger.error(
            "Capability override read failed",
            "useModelCapabilityOverrides",
            { error }
          )
        })
    }
    load()
    const unsubscribe = subscribeModelPreferences((kind) => {
      if (kind === "capabilities") load()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  const [probes] = useSetting(POLICY_SETTINGS.MODEL_CAPABILITY_PROBES)

  const getOverride = useCallback(
    (providerId: string, modelName: string): ModelCapabilityOverride | null =>
      overrides[modelCapabilityOverrideKey(providerId, modelName)] ?? null,
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
    overrides,
    getOverride,
    getProbe,
    resolve,
    setOverride: setModelCapabilityOverride,
    clearOverride: clearModelCapabilityOverride
  }
}
