import type { StorageSyncScope } from "@/lib/storage/storage-key-registry"

export const SETTINGS_TABS = [
  "general",
  "models",
  "knowledge",
  "browser",
  "privacy",
  "help"
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const SETTINGS_LEVELS = ["basic", "power", "advanced"] as const
export type SettingsLevel = (typeof SETTINGS_LEVELS)[number]

export interface SettingsEntry {
  /** Kebab-case focus id; equals the control's data-settings-focus-id. */
  id: string
  /** Which options tab the control is rendered on. */
  tab: SettingsTab
  /** Logical group within a tab, used for presets, reset, and grouping. */
  sectionId: string
  /** i18n key for the control's label. */
  labelKey: string
  /** i18n key for the control's description, when it has one. */
  descriptionKey?: string
  /** Additional visible i18n strings that should route to this setting. */
  searchKeys?: string[]
  /** Focus target override for search records; defaults to id. */
  focusId?: string
  /** Extra search terms for fuzzy matching. */
  keywords?: string[]
  /** Non-i18n search aliases, typos, and technical synonyms. */
  aliases?: string[]
  /** Power-user tuning control eligible for advanced grouping. */
  advanced?: boolean
  /** Minimum progressive-disclosure level needed to show this setting. */
  level?: SettingsLevel
  /** Registered persistence key, when this UI maps to stored state. */
  storageKey?: string
  /** Derived from storageKey; never duplicate scope by hand. */
  scope?: StorageSyncScope
  /** Deletes or clears data. */
  destructive?: boolean
}

export type SettingsEntryDefinition = Omit<SettingsEntry, "tab" | "scope">
