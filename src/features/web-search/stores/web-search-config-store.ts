import { useStorage } from "@plasmohq/storage/hook"
import { useCallback } from "react"
import { STORAGE_KEYS } from "@/lib/constants"
import { getPlasmoStorageForKey } from "@/lib/plasmo-global-storage"
import {
  DEFAULT_WEB_SEARCH_CONFIG,
  getWebSearchConfig,
  normalizeWebSearchConfig,
  setWebSearchConfig,
  type WebSearchProviderConfig
} from "@/lib/tools/web-search"

const webSearchStorage = getPlasmoStorageForKey(STORAGE_KEYS.WEB_SEARCH.CONFIG)

export const useWebSearchConfig = () => {
  const [config, setConfig] = useStorage<WebSearchProviderConfig>(
    {
      key: STORAGE_KEYS.WEB_SEARCH.CONFIG,
      instance: webSearchStorage
    },
    DEFAULT_WEB_SEARCH_CONFIG
  )

  const updateConfig = useCallback(
    (updates: Partial<WebSearchProviderConfig>) => {
      setConfig((prev) =>
        normalizeWebSearchConfig({
          ...prev,
          ...updates
        })
      )
    },
    [setConfig]
  )

  return {
    config: normalizeWebSearchConfig(config),
    updateConfig
  }
}

export type { WebSearchProviderConfig }
export { getWebSearchConfig, setWebSearchConfig }
