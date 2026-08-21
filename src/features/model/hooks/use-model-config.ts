import { useCallback, useMemo } from "react"
import { useSetting } from "@/hooks/use-setting"
import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import {
  getStoredModelConfig,
  modelConfigKey,
  normalizeStoredModelConfig,
  parseStoredModelConfigMap
} from "@/lib/model-config-utils"
import { SETTINGS } from "@/lib/storage/settings"

export type ProviderModelConfig = typeof DEFAULT_MODEL_CONFIG

export const useModelConfig = (modelName: string, providerId?: string) => {
  const [modelConfigs, setModelConfigs] = useSetting(SETTINGS.MODEL_CONFIGS)

  const config = useMemo(() => {
    const stored = normalizeStoredModelConfig(
      getStoredModelConfig(
        parseStoredModelConfigMap(modelConfigs),
        modelName,
        providerId
      )
    )
    return {
      ...DEFAULT_MODEL_CONFIG,
      ...(stored ?? {})
    }
  }, [modelName, providerId, modelConfigs])

  const update = useCallback(
    (newConfig: Partial<typeof DEFAULT_MODEL_CONFIG>) => {
      setModelConfigs((prev) => {
        const parsed = parseStoredModelConfigMap(prev)
        const key = modelConfigKey(modelName, providerId)
        const prevConfig =
          normalizeStoredModelConfig(
            getStoredModelConfig(parsed, modelName, providerId)
          ) ?? {}
        return {
          ...parsed,
          [key]: {
            ...DEFAULT_MODEL_CONFIG,
            ...prevConfig,
            ...newConfig
          }
        }
      })
    },
    [modelName, providerId, setModelConfigs]
  )

  return [config, update] as const
}
