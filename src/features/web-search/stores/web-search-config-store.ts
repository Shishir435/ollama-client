import { useCallback } from "react"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"
import {
  getWebSearchConfig,
  normalizeWebSearchConfig,
  setWebSearchConfig,
  type WebSearchProviderConfig
} from "@/lib/tools/web-search"

/**
 * Per-device "use web search in this chat" flag. Separate from
 * `config.enabled` (settings-level "configured/available") so the composer
 * toggle doesn't silently flip the settings switch.
 */
export const useWebSearchActive = () => {
  const [active, setActive] = useSetting(SETTINGS.WEB_SEARCH_ACTIVE)
  return { active, setActive }
}

export const useWebSearchConfig = () => {
  const [config, setConfig] = useSetting(SETTINGS.WEB_SEARCH_CONFIG)

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
