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

const RULE_MODES: unknown[] = ["inherit", "always", "never"]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isPerSiteProfile = (value: unknown): value is PerSiteProfile =>
  isRecord(value) &&
  Object.keys(value).length === 6 &&
  typeof value.id === "string" &&
  value.id.length > 0 &&
  typeof value.name === "string" &&
  typeof value.pattern === "string" &&
  typeof value.enabled === "boolean" &&
  RULE_MODES.includes(value.tabContext) &&
  RULE_MODES.includes(value.groundedOnly)

export const PerSiteProfileSettingsSchema = {
  safeParse: (
    value: unknown
  ): { success: true; data: PerSiteProfileSettings } | { success: false } => {
    if (
      !isRecord(value) ||
      Object.keys(value).some((key) => key !== "profiles") ||
      !Array.isArray(value.profiles) ||
      !value.profiles.every(isPerSiteProfile)
    ) {
      return { success: false }
    }
    return { success: true, data: { profiles: value.profiles } }
  }
}

export const parsePerSiteProfileSettings = (
  value: unknown
): PerSiteProfileSettings => {
  const parsed = PerSiteProfileSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_PER_SITE_PROFILE_SETTINGS
}
