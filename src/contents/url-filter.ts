import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ContentExtractionConfig } from "@/types"

/**
 * Resolve the active list of excluded URL patterns.
 *
 * Precedence:
 *   1. Patterns in the unified ContentExtractionConfig (current storage)
 *   2. Patterns in the legacy `EXCLUDE_URL_PATTERNS` storage key (backward compat)
 *   3. Defaults from DEFAULT_CONTENT_EXTRACTION_CONFIG
 */
export const resolveExcludedUrlPatterns = async (): Promise<string[]> => {
  const storedConfig = await plasmoGlobalStorage.get<ContentExtractionConfig>(
    STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG
  )

  if (storedConfig?.excludedUrlPatterns?.length) {
    return storedConfig.excludedUrlPatterns
  }

  const legacy = await plasmoGlobalStorage.get<string[]>(
    STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS
  )
  if (legacy?.length) return legacy

  return DEFAULT_CONTENT_EXTRACTION_CONFIG.excludedUrlPatterns
}

/**
 * Test a URL against a list of patterns. Each pattern is tried as a regex
 * first; if invalid, falls back to a substring match. Match-any semantics.
 */
export const urlMatchesAny = (url: string, patterns: string[]): boolean => {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(url)
    } catch {
      return url.includes(pattern)
    }
  })
}

/** True if `url` should be excluded from content extraction. */
export const isExcludedUrl = async (url: string): Promise<boolean> => {
  const patterns = await resolveExcludedUrlPatterns()
  return urlMatchesAny(url, patterns)
}
