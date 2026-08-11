import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useMemo } from "react"
import { DEFAULT_MODEL_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import {
  normalizeStoredModelConfig,
  parseStoredModelConfigMap,
  type StoredModelConfigMap
} from "@/lib/model-config-utils"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export type ProviderModelConfig = typeof DEFAULT_MODEL_CONFIG

export const useModelConfig = (modelName: string) => {
  const [modelConfigs, setModelConfigs] = useStorage<StoredModelConfigMap>(
    { key: STORAGE_KEYS.PROVIDER.MODEL_CONFIGS, instance: plasmoGlobalStorage },
    {}
  )

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
