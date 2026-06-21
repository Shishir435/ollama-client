import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"

export type PerSiteRuleMode = "inherit" | "always" | "never"

export interface PerSiteProfile {
  id: string
  name: string
  pattern: string
  enabled: boolean
  tabContext: PerSiteRuleMode
  groundedOnly: PerSiteRuleMode
}

export interface PerSiteProfileSettings {
  profiles: PerSiteProfile[]
}

export const DEFAULT_PER_SITE_PROFILE_SETTINGS: PerSiteProfileSettings = {
  profiles: []
}

export const getPerSiteProfileSettings =
  async (): Promise<PerSiteProfileSettings> => {
    const stored = await getPlasmoStoredValue<Partial<PerSiteProfileSettings>>(
      STORAGE_KEYS.BROWSER.PER_SITE_PROFILES
    )

    return {
      profiles: Array.isArray(stored?.profiles) ? stored.profiles : []
    }
  }

export const setPerSiteProfileSettings = async (
  settings: PerSiteProfileSettings
): Promise<void> => {
  await setPlasmoStoredValue(STORAGE_KEYS.BROWSER.PER_SITE_PROFILES, {
    profiles: settings.profiles
  })
}

const wildcardToRegExp = (pattern: string): RegExp => {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*")
  return new RegExp(escaped, "i")
}

export const profilePatternMatchesUrl = (
  pattern: string,
  url: string
): boolean => {
  const trimmed = pattern.trim()
  if (!trimmed || !url) return false

  try {
    if (new RegExp(trimmed, "i").test(url)) return true
  } catch {
    // Invalid regex still gets wildcard/substr fallback.
  }

  try {
    const parsed = new URL(url)
    const target = `${parsed.hostname}${parsed.pathname}`.toLowerCase()
    const lowerPattern = trimmed.toLowerCase()
    if (
      target.includes(lowerPattern) ||
      url.toLowerCase().includes(lowerPattern)
    ) {
      return true
    }
    return wildcardToRegExp(lowerPattern).test(target)
  } catch {
    return url.toLowerCase().includes(trimmed.toLowerCase())
  }
}

export const getMatchingPerSiteProfile = (
  url: string,
  settings: PerSiteProfileSettings
): PerSiteProfile | undefined => {
  return settings.profiles.find(
    (profile) =>
      profile.enabled && profilePatternMatchesUrl(profile.pattern, url)
  )
}

export const getActivePerSiteProfile = async (
  url: string
): Promise<PerSiteProfile | undefined> => {
  const settings = await getPerSiteProfileSettings()
  return getMatchingPerSiteProfile(url, settings)
}

export const isNeverReadUrl = async (url: string): Promise<boolean> => {
  const profile = await getActivePerSiteProfile(url)
  return profile?.tabContext === "never"
}
