import {
  normalizeSettingsSearchText,
  scoreSettingsSearchToken
} from "@/features/settings/settings-search-scoring"
import { getStorageKeyMetadata } from "@/lib/storage/storage-key-registry"
import { BROWSER_SETTINGS } from "./registry/browser"
import { GENERAL_SETTINGS } from "./registry/general"
import { HELP_SETTINGS } from "./registry/help"
import { KNOWLEDGE_SETTINGS } from "./registry/knowledge"
import { MODELS_SETTINGS } from "./registry/models"
import { SETTINGS_REGISTRY_ORDER } from "./registry/order"
import { PRIVACY_SETTINGS } from "./registry/privacy"
import {
  SETTINGS_LEVELS,
  SETTINGS_TABS,
  type SettingsEntry,
  type SettingsEntryDefinition,
  type SettingsLevel,
  type SettingsTab
} from "./registry/types"

export type {
  SettingsEntry,
  SettingsEntryDefinition,
  SettingsLevel,
  SettingsTab
} from "./registry/types"
export { SETTINGS_LEVELS, SETTINGS_TABS } from "./registry/types"

const LEGACY_TAB_MAP = {
  chat: "general",
  "model-behavior": "models",
  providers: "models",
  "knowledge-web": "knowledge",
  "saved-knowledge": "knowledge",
  "page-tabs": "browser",
  "prompt-library": "general",
  shortcuts: "general",
  speech: "general",
  privacy: "privacy",
  "data-backup": "privacy",
  help: "help"
} as const

type LegacySettingsTab = keyof typeof LEGACY_TAB_MAP

const withTab = (
  tab: SettingsTab,
  entries: readonly SettingsEntryDefinition[]
): SettingsEntry[] =>
  entries.map((entry) => ({
    ...entry,
    tab,
    scope: entry.storageKey
      ? getStorageKeyMetadata(entry.storageKey)?.scope
      : undefined
  }))

const SETTINGS_REGISTRY_BY_TAB: SettingsEntry[] = [
  ...withTab("general", GENERAL_SETTINGS),
  ...withTab("models", MODELS_SETTINGS),
  ...withTab("knowledge", KNOWLEDGE_SETTINGS),
  ...withTab("browser", BROWSER_SETTINGS),
  ...withTab("privacy", PRIVACY_SETTINGS),
  ...withTab("help", HELP_SETTINGS)
]

const SETTINGS_ORDER_BY_ID = new Map<string, number>(
  SETTINGS_REGISTRY_ORDER.map((id, index) => [id, index])
)

export const SETTINGS_REGISTRY: SettingsEntry[] = [
  ...SETTINGS_REGISTRY_BY_TAB
].sort(
  (left, right) =>
    (SETTINGS_ORDER_BY_ID.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (SETTINGS_ORDER_BY_ID.get(right.id) ?? Number.MAX_SAFE_INTEGER)
)

const SETTINGS_LEVEL_RANK: Record<SettingsLevel, number> = {
  basic: 0,
  power: 1,
  advanced: 2
}

const POWER_DISCLOSURE_SECTIONS = new Set(["voices", "prompts", "shortcuts"])

export const getSettingsEntryLevel = (
  entry: SettingsEntry | undefined
): SettingsLevel =>
  entry?.level ??
  (entry?.advanced
    ? "advanced"
    : entry && POWER_DISCLOSURE_SECTIONS.has(entry.sectionId)
      ? "power"
      : "basic")

export const settingsLevelIncludes = (
  current: SettingsLevel,
  required: SettingsLevel
): boolean => SETTINGS_LEVEL_RANK[current] >= SETTINGS_LEVEL_RANK[required]

export const maxSettingsLevel = (
  left: SettingsLevel,
  right: SettingsLevel
): SettingsLevel =>
  SETTINGS_LEVEL_RANK[left] >= SETTINGS_LEVEL_RANK[right] ? left : right

export const isSettingsLevel = (value: unknown): value is SettingsLevel =>
  typeof value === "string" && SETTINGS_LEVELS.includes(value as SettingsLevel)

const TAB_SET = new Set<string>(SETTINGS_TABS)

/** Type guard: is `tab` a real options-page tab key. */
export const isSettingsTab = (tab: string): tab is SettingsTab =>
  TAB_SET.has(tab)

/** Resolve current and pre-0.12.1 deep links to the six intent tabs. */
export const resolveSettingsTab = (
  tab: string | null | undefined
): SettingsTab | undefined => {
  if (!tab) return undefined
  if (isSettingsTab(tab)) return tab
  return LEGACY_TAB_MAP[tab as LegacySettingsTab]
}

/** All entries rendered on a given tab. */
export const getSettingsForTab = (tab: SettingsTab): SettingsEntry[] =>
  SETTINGS_REGISTRY.filter((entry) => entry.tab === tab)

/** All entries belonging to a logical section. */
export const getSectionEntries = (sectionId: string): SettingsEntry[] =>
  SETTINGS_REGISTRY.filter((entry) => entry.sectionId === sectionId)

/** Look up a single entry by its focus id. */
export const getSettingsEntry = (id: string): SettingsEntry | undefined =>
  SETTINGS_REGISTRY.find((entry) => entry.id === id || entry.focusId === id)

/**
 * Optional translator: resolves an i18n key to display text. When supplied,
 * `searchSettings` also matches against the resolved label/description so a
 * user's query hits the words they actually see, not just keywords. Without it
 * search still works off id + keywords + the raw key strings.
 */
export type Translate = (key: string) => string

export interface RankedSettingsEntry {
  entry: SettingsEntry
  score: number
}

const getSearchParts = (entry: SettingsEntry, translate?: Translate) => {
  const parts = [
    entry.id.replace(/-/g, " "),
    entry.id,
    entry.labelKey,
    entry.descriptionKey ?? "",
    ...(entry.searchKeys ?? []),
    ...(entry.aliases ?? []),
    ...(entry.keywords ?? [])
  ]
  if (translate) {
    parts.push(translate(entry.labelKey))
    if (entry.descriptionKey) parts.push(translate(entry.descriptionKey))
  }
  return parts
}

/**
 * Search the registry. Ranks exact phrases, exact words, substrings, and small
 * typos against the entry's id, keywords, label/description i18n keys, and —
 * when `translate` is given — the resolved label/description text.
 *
 * Returns ranked matches. An empty/whitespace query returns [].
 */
export const searchSettings = (
  query: string,
  translate?: Translate
): SettingsEntry[] => {
  return rankSettings(query, translate).map((result) => result.entry)
}

export const rankSettings = (
  query: string,
  translate?: Translate
): RankedSettingsEntry[] => {
  const normalizedQuery = normalizeSettingsSearchText(query)
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []

  return SETTINGS_REGISTRY.map((entry, index) => {
    const haystack = normalizeSettingsSearchText(
      getSearchParts(entry, translate).join(" ")
    )
    const words = haystack.split(/\s+/).filter(Boolean)
    const phraseScore = haystack.includes(normalizedQuery) ? 100 : 0
    const tokenScore = tokens.reduce(
      (total, token) =>
        total + scoreSettingsSearchToken(token, haystack, words),
      0
    )
    return {
      entry,
      score: phraseScore + tokenScore,
      index
    }
  })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ entry, score }) => ({ entry, score }))
}
