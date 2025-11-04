import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect } from "react"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ContentExtractionConfig } from "@/types"
import { ExcludedUrls } from "./exclude-urls"
import { GlobalSettings } from "./global-settings"
import { SiteSpecificOverrides } from "./site-specific-overrides"

const useContentExtractionConfig = () => {
  const [config, setConfig] = useStorage<ContentExtractionConfig>(
    {
      key: STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_CONTENT_EXTRACTION_CONFIG
  )

  const updateConfig = useCallback(
    (updates: Partial<ContentExtractionConfig>) => {
      setConfig((prev) => ({
        ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
        ...prev,
        ...updates
      }))
    },
    [setConfig]
  )

  // Ensure contentScraper is set (for backward compatibility)
  useEffect(() => {
    if (!config.contentScraper) {
      updateConfig({ contentScraper: "auto" })
    }
  }, [config.contentScraper, updateConfig])

  return [config, updateConfig] as const
}

export const ContentExtractionSettings = () => {
  const [config, updateConfig] = useContentExtractionConfig()

  // Migrate from old storage key if needed
  useEffect(() => {
    if (
      !config.excludedUrlPatterns ||
      config.excludedUrlPatterns.length === 0
    ) {
      plasmoGlobalStorage
        .get<string[]>(STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS)
        .then((oldPatterns) => {
          if (oldPatterns && oldPatterns.length > 0) {
            updateConfig({ excludedUrlPatterns: oldPatterns })
          }
        })
        .catch(() => {
          // Ignore errors
        })
    }
  }, [config.excludedUrlPatterns, updateConfig])

  const handleAddPattern = (pattern: string) => {
    updateConfig({
      excludedUrlPatterns: [pattern, ...config.excludedUrlPatterns]
    })
  }

  const handleRemovePattern = (pattern: string) => {
    updateConfig({
      excludedUrlPatterns: config.excludedUrlPatterns.filter(
        (p) => p !== pattern
      )
    })
  }

  const handleAddSiteOverride = (pattern: string) => {
    updateConfig({
      siteOverrides: {
        ...config.siteOverrides,
        [pattern]: {}
      }
    })
  }

  const handleRemoveSiteOverride = (pattern: string) => {
    const newOverrides = { ...config.siteOverrides }
    delete newOverrides[pattern]
    updateConfig({ siteOverrides: newOverrides })
  }

  const handleUpdateSiteOverride = (
    pattern: string,
    updates: Partial<ContentExtractionConfig>
  ) => {
    updateConfig({
      siteOverrides: {
        ...config.siteOverrides,
        [pattern]: {
          ...config.siteOverrides[pattern],
          ...updates
        }
      }
    })
  }

  return (
    <div className="mx-auto space-y-6">
      <GlobalSettings config={config} onUpdate={updateConfig} />

      <ExcludedUrls
        patterns={config.excludedUrlPatterns}
        onAdd={handleAddPattern}
        onRemove={handleRemovePattern}
      />

      <SiteSpecificOverrides
        config={config}
        onAddSiteOverride={handleAddSiteOverride}
        onRemoveSiteOverride={handleRemoveSiteOverride}
        onUpdateSiteOverride={handleUpdateSiteOverride}
      />
    </div>
  )
}
