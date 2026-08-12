import { STORAGE_KEYS } from "@/lib/constants"
import {
  DEFAULT_PER_SITE_PROFILE_SETTINGS,
  type PerSiteProfileSettings,
  PerSiteProfileSettingsSchema
} from "@/lib/per-site-profile-settings"
import { defineSetting } from "./setting-descriptor"

export const PER_SITE_PROFILE_SETTING = defineSetting<PerSiteProfileSettings>(
  STORAGE_KEYS.BROWSER.PER_SITE_PROFILES,
  {
    defaultValue: DEFAULT_PER_SITE_PROFILE_SETTINGS,
    parser: PerSiteProfileSettingsSchema
  }
)
