import { useMemo } from "react"

import { DEFAULT_MODEL_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { useStorage } from "@plasmohq/storage/hook"

export function useModelConfig(modelName: string) {
  const [modelConfigs, setModelConfigs] = useStorage<
    Record<string, typeof DEFAULT_MODEL_CONFIG>
  >(
    { key: STORAGE_KEYS.OLLAMA.MODEL_CONFIGS, instance: plasmoGlobalStorage },
    {}
  )

  const config = useMemo(() => {
    const stored = modelConfigs?.[modelName]
    return {
      ...DEFAULT_MODEL_CONFIG,
      ...(stored ?? {})
    }
  }, [modelName, modelConfigs])

  const update = (newConfig: Partial<typeof DEFAULT_MODEL_CONFIG>) => {
    setModelConfigs((prev) => {
      const prevConfig = prev?.[modelName] ?? {}
      return {
        ...prev,
        [modelName]: {
          ...DEFAULT_MODEL_CONFIG,
          ...prevConfig,
          ...newConfig
        }
      }
    })
  }

  return [config, update] as const
}
