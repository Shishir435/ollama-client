/**
 * Settings presets — curated combinations users can apply in one click.
 *
 * A preset is a declarative list of {@link SettingWrite}s (the same shape
 * `getSectionDefaults` returns), applied via `applyStorageWrites`. "Balanced"
 * is the recommended baseline built from the centralized section defaults (F2),
 * so it never duplicates default literals; the other presets are defined as
 * explicit diffs against that baseline and so stay reviewable.
 *
 * Per-setting controls remain fully editable after applying a preset — a preset
 * is just a batch write, not a lock.
 */

import { STORAGE_KEYS } from "@/lib/constants"
import { getSectionDefaults } from "@/lib/constants/section-defaults"
import type { SettingWrite } from "./apply-settings"

export interface SettingsPreset {
  id: string
  labelKey: string
  descriptionKey: string
  writes: SettingWrite[]
}

const { CHAT, EMBEDDINGS, BROWSER, WEB_SEARCH } = STORAGE_KEYS

// Balanced = the recommended defaults for the tunable sections. Sourced from
// the F2 manifest so it tracks any future default change automatically.
const BALANCED_WRITES: SettingWrite[] = [
  ...getSectionDefaults("prompt-budget"),
  ...getSectionDefaults("grounding"),
  ...getSectionDefaults("retrieval"),
  ...getSectionDefaults("chunking")
]

export const SETTINGS_PRESETS: SettingsPreset[] = [
  {
    id: "fast",
    labelKey: "settings.presets.fast.label",
    descriptionKey: "settings.presets.fast.description",
    writes: [
      { storageKey: CHAT.MAX_TAB_CONTEXT_CHARS, value: 6000 },
      { storageKey: CHAT.MAX_RAG_CONTEXT_CHARS, value: 8000 },
      { storageKey: CHAT.MAX_TOOL_RESULT_CHARS, value: 6000 },
      { storageKey: EMBEDDINGS.CONFIG, field: "defaultSearchLimit", value: 5 },
      { storageKey: EMBEDDINGS.CONFIG, field: "useReranking", value: false }
    ]
  },
  {
    id: "balanced",
    labelKey: "settings.presets.balanced.label",
    descriptionKey: "settings.presets.balanced.description",
    writes: BALANCED_WRITES
  },
  {
    id: "large-context",
    labelKey: "settings.presets.large_context.label",
    descriptionKey: "settings.presets.large_context.description",
    writes: [
      { storageKey: CHAT.MAX_TAB_CONTEXT_CHARS, value: 24000 },
      { storageKey: CHAT.MAX_RAG_CONTEXT_CHARS, value: 32000 },
      { storageKey: CHAT.MAX_TOOL_RESULT_CHARS, value: 16000 },
      { storageKey: EMBEDDINGS.CONFIG, field: "defaultSearchLimit", value: 15 },
      { storageKey: EMBEDDINGS.CONFIG, field: "useReranking", value: true }
    ]
  },
  {
    // Privacy strict, defined explicitly so it's reviewable, not vibes:
    // no page access, answers grounded to the page, no auto-embed of chat,
    // web search off, caps tightened.
    id: "privacy-strict",
    labelKey: "settings.presets.privacy_strict.label",
    descriptionKey: "settings.presets.privacy_strict.description",
    writes: [
      { storageKey: BROWSER.TABS_ACCESS, value: false },
      { storageKey: CHAT.GROUNDED_ONLY_MODE, value: true },
      { storageKey: CHAT.AUTO_REFRESH_TAB_CONTEXT, value: false },
      { storageKey: EMBEDDINGS.AUTO_EMBED_CHAT, value: false },
      { storageKey: EMBEDDINGS.GLOBAL_AUTO_EMBED, value: false },
      { storageKey: WEB_SEARCH.CONFIG, field: "enabled", value: false },
      { storageKey: CHAT.MAX_TAB_CONTEXT_CHARS, value: 6000 },
      { storageKey: CHAT.MAX_RAG_CONTEXT_CHARS, value: 8000 }
    ]
  }
]

export const getPreset = (id: string): SettingsPreset | undefined =>
  SETTINGS_PRESETS.find((preset) => preset.id === id)
