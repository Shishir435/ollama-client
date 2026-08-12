import { DEFAULT_CONTENT_EXTRACTION_CONFIG } from "@/lib/constants"
import { getEffectiveConfig } from "@/lib/content-extractor"
import { EXCLUDE_URL_PATTERNS_SETTING } from "@/lib/storage/content-policy-settings"
import { CONTENT_SETTINGS } from "@/lib/storage/content-settings"
import { readSetting, readStoredSetting } from "@/lib/storage/setting-access"
import type { ContentExtractionConfig } from "@/types"

export const resolveActiveConfig = async (
  currentUrl: string
): Promise<{
  effectiveConfig: ContentExtractionConfig
  hasSiteOverride: boolean
}> => {
  const stored = await readStoredSetting(
    CONTENT_SETTINGS.CONTENT_EXTRACTION_CONFIG
  )

  let excludedUrlPatterns = stored?.excludedUrlPatterns
  if (!excludedUrlPatterns || excludedUrlPatterns.length === 0) {
    const oldPatterns = await readSetting(EXCLUDE_URL_PATTERNS_SETTING)
    excludedUrlPatterns = oldPatterns
  }

  const globalConfig: ContentExtractionConfig = stored
    ? {
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
