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
    profiles: normalizePerSiteProfiles(settings.profiles)
  })
}

export const createPerSiteProfile = (
  input: Partial<PerSiteProfile> & Pick<PerSiteProfile, "pattern">
): PerSiteProfile => ({
  id:
    input.id ||
    globalThis.crypto?.randomUUID?.() ||
    `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  name: input.name?.trim() || input.pattern.trim(),
  pattern: input.pattern.trim(),
  enabled: input.enabled ?? true,
  tabContext: input.tabContext ?? "inherit",
  groundedOnly: input.groundedOnly ?? "inherit"
})

export const normalizePerSiteProfiles = (
  profiles: PerSiteProfile[]
): PerSiteProfile[] =>
  profiles
    .filter((profile) => profile.pattern.trim())
    .map((profile) =>
      createPerSiteProfile({
        ...profile,
        name: profile.name || profile.pattern,
        pattern: profile.pattern
      })
    )

const wildcardToRegExp = (pattern: string): RegExp => {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*")
  return new RegExp(`^${escaped}`, "i")
}

const looksLikeExplicitRegExp = (pattern: string): boolean =>
  /[\\^$+?()[\]{}|]/.test(pattern)

export const profilePatternMatchesUrl = (
  pattern: string,
  url: string
): boolean => {
  const trimmed = pattern.trim()
  if (!trimmed || !url) return false

  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const target = `${hostname}${parsed.pathname}`.toLowerCase()
    const lowerPattern = trimmed.toLowerCase()

    if (!lowerPattern.includes("/") && !lowerPattern.includes("*")) {
      if (hostname === lowerPattern || hostname.endsWith(`.${lowerPattern}`)) {
        return true
      }
      return false
    }

    if (wildcardToRegExp(lowerPattern).test(target)) {
      return true
    }
  } catch {
    if (wildcardToRegExp(trimmed.toLowerCase()).test(url.toLowerCase())) {
      return true
    }
  }

  if (looksLikeExplicitRegExp(trimmed)) {
    try {
      return new RegExp(trimmed, "i").test(url)
    } catch {
      return false
    }
  }

  return false
}

export const getMatchingPerSiteProfile = (
  url: string,
  settings: PerSiteProfileSettings
): PerSiteProfile | undefined => {
  return settings.profiles
    .filter(
      (profile) =>
        profile.enabled && profilePatternMatchesUrl(profile.pattern, url)
    )
    .sort((a, b) => b.pattern.length - a.pattern.length)[0]
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

export const resolveGroundedOnlyModeForUrls = (
  urls: string[],
  profiles: PerSiteProfile[],
  fallback: boolean
): boolean => {
  const modes = urls
    .map((url) => getMatchingPerSiteProfile(url, { profiles }))
    .filter((profile): profile is PerSiteProfile => Boolean(profile))
    .map((profile) => profile.groundedOnly)

  if (modes.includes("always")) return true
  if (modes.includes("never")) return false
  return fallback
}
