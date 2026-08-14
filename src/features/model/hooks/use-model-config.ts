import { useCallback, useMemo } from "react"
import { useSetting } from "@/hooks/use-setting"
import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import {
  normalizeStoredModelConfig,
  parseStoredModelConfigMap
} from "@/lib/model-config-utils"
import { SETTINGS } from "@/lib/storage/settings"

export type ProviderModelConfig = typeof DEFAULT_MODEL_CONFIG

export const useModelConfig = (modelName: string) => {
  const [modelConfigs, setModelConfigs] = useSetting(SETTINGS.MODEL_CONFIGS)

  const config = useMemo(() => {
    const stored = normalizeStoredModelConfig(
      parseStoredModelConfigMap(modelConfigs)[modelName]
    )
    return {
      ...DEFAULT_MODEL_CONFIG,
      ...(stored ?? {})
    }
  }, [modelName, modelConfigs])

  const update = useCallback(
    (newConfig: Partial<typeof DEFAULT_MODEL_CONFIG>) => {
      setModelConfigs((prev) => {
        const parsed = parseStoredModelConfigMap(prev)
        const prevConfig = normalizeStoredModelConfig(parsed[modelName]) ?? {}
        return {
          ...parsed,
          [modelName]: {
            ...DEFAULT_MODEL_CONFIG,
            ...prevConfig,
            ...newConfig
          }
        }
      })
    },
    [modelName, setModelConfigs]
  )

  return [config, update] as const
}
