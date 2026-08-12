import { z } from "zod"

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

const PerSiteRuleModeSchema = z.enum(["inherit", "always", "never"])

export const PerSiteProfileSettingsSchema = z
  .object({
    profiles: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string(),
          pattern: z.string(),
          enabled: z.boolean(),
          tabContext: PerSiteRuleModeSchema,
          groundedOnly: PerSiteRuleModeSchema
        })
        .strict()
    )
  })
  .strict()

export const DEFAULT_PER_SITE_PROFILE_SETTINGS: PerSiteProfileSettings = {
  profiles: []
}

export const parsePerSiteProfileSettings = (
  value: unknown
): PerSiteProfileSettings => {
  const parsed = PerSiteProfileSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_PER_SITE_PROFILE_SETTINGS
}
