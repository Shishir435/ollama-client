import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  STORAGE_KEYS
} from "@/lib/constants"
import { getEffectiveConfig } from "@/lib/content-extractor"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ContentExtractionConfig } from "@/types"

export const resolveActiveConfig = async (
  currentUrl: string
): Promise<{
  effectiveConfig: ContentExtractionConfig
  hasSiteOverride: boolean
}> => {
  const stored = await plasmoGlobalStorage.get<ContentExtractionConfig>(
    STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG
  )

  let excludedUrlPatterns = stored?.excludedUrlPatterns
  if (!excludedUrlPatterns || excludedUrlPatterns.length === 0) {
    const oldPatterns = await plasmoGlobalStorage.get<string[]>(
      STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS
    )
    excludedUrlPatterns =
      oldPatterns || DEFAULT_CONTENT_EXTRACTION_CONFIG.excludedUrlPatterns
  }

  const globalConfig: ContentExtractionConfig = stored
    ? {
        ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
        ...stored,
        excludedUrlPatterns,
        siteOverrides: stored.siteOverrides || {}
      }
    : {
        ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
        excludedUrlPatterns
      }

  const effectiveConfig = getEffectiveConfig(
    currentUrl,
    globalConfig,
    DEFAULT_CONTENT_EXTRACTION_CONFIG
  )

  const hasSiteOverride = Object.keys(globalConfig.siteOverrides).some(
    (pattern) => {
      try {
        return new RegExp(pattern).test(currentUrl)
      } catch {
        return currentUrl.includes(pattern)
      }
    }
  )

  return { effectiveConfig, hasSiteOverride }
}
