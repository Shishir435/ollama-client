import { isNeverReadUrl } from "@/lib/per-site-profiles"
import { EXCLUDE_URL_PATTERNS_SETTING } from "@/lib/storage/content-policy-settings"
import { CONTENT_SETTINGS } from "@/lib/storage/content-settings"
import { readSetting, readStoredSetting } from "@/lib/storage/setting-access"
import { matchesUserPattern } from "@/lib/url-pattern"

/**
 * Resolve the active list of excluded URL patterns.
 *
 * Precedence:
 *   1. Patterns in the unified ContentExtractionConfig (current storage)
 *   2. Patterns in the legacy `EXCLUDE_URL_PATTERNS` storage key (backward compat)
 *   3. Defaults from DEFAULT_CONTENT_EXTRACTION_CONFIG
 */
export const resolveExcludedUrlPatterns = async (): Promise<string[]> => {
  const storedConfig = await readStoredSetting(
    CONTENT_SETTINGS.CONTENT_EXTRACTION_CONFIG
  )

  if (storedConfig?.excludedUrlPatterns?.length) {
    return storedConfig.excludedUrlPatterns
  }

  const legacy = await readSetting(EXCLUDE_URL_PATTERNS_SETTING)
  if (legacy?.length) return legacy

  return CONTENT_SETTINGS.CONTENT_EXTRACTION_CONFIG.defaultValue
    .excludedUrlPatterns
}

/**
 * Test a URL against a list of patterns. Each pattern is tried as a regex
 * first; if invalid or unsafe, falls back to a substring match. Match-any
 * semantics — see `matchesUserPattern` for the guarding rules.
 */
export const urlMatchesAny = (url: string, patterns: string[]): boolean => {
  return patterns.some((pattern) => matchesUserPattern(url, pattern))
}

/** True if `url` should be excluded from content extraction. */
export const isExcludedUrl = async (url: string): Promise<boolean> => {
  const patterns = await resolveExcludedUrlPatterns()
  return urlMatchesAny(url, patterns) || (await isNeverReadUrl(url))
}
