import { describe, expect, it } from "vitest"
import type { SettingsEntry } from "../settings-registry"
import {
  buildSettingsSearchRecords,
  rankSettingsSearchRecords
} from "../settings-search-index"

const messages: Record<string, string> = {
  "settings.presets.title": "Presets",
  "settings.presets.description": "Apply a tuned combination in one click.",
  "settings.presets.fast.label": "Fast",
  "settings.presets.fast.description": "Quicker, lighter responses.",
  "settings.presets.balanced.label": "Balanced",
  "settings.presets.large_context.label": "Large context",
  "settings.presets.privacy_strict.label": "Privacy strict",
  "settings.providers.base_url": "Base URL",
  "settings.providers.base_url_default": "Default",
  "settings.base_url.label": "Provider API Server Endpoint",
  "settings.prompt_context_limits.max_tab_context_chars":
    "Max tab context chars"
}

const t = (key: string) => messages[key] ?? key

const entries: SettingsEntry[] = [
  {
    id: "settings-presets",
    tab: "general",
    sectionId: "presets",
    labelKey: "settings.presets.title",
    descriptionKey: "settings.presets.description",
    searchKeys: [
      "settings.presets.fast.label",
      "settings.presets.fast.description",
      "settings.presets.balanced.label",
      "settings.presets.large_context.label",
      "settings.presets.privacy_strict.label",
      "settings.presets.applied"
    ],
    aliases: ["preset", "provder"]
  },
  {
    id: "provider-base-url",
    tab: "providers",
    sectionId: "providers",
    labelKey: "settings.providers.base_url",
    descriptionKey: "settings.providers.base_url_default",
    searchKeys: ["settings.base_url.label"],
    aliases: ["base url", "endpoint"]
  },
  {
    id: "max-tab-context-chars",
    tab: "context",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.max_tab_context_chars",
    aliases: ["character budget"]
  }
]

describe("settings-search-index", () => {
  it("builds visible child records from explicit search keys", () => {
    const records = buildSettingsSearchRecords(entries, t)
    expect(records.map((record) => record.displayLabel)).toEqual(
      expect.arrayContaining([
        "Fast",
        "Balanced",
        "Large context",
        "Privacy strict"
      ])
    )
    expect(
      records.find((record) => record.displayLabel === "Balanced")
    ).toMatchObject({
      entryId: "settings-presets",
      focusId: "settings-presets",
      tab: "general",
      displayContext: "Presets"
    })
  })

  it("skips unresolved and interpolation keys", () => {
    const records = buildSettingsSearchRecords(entries, t)
    expect(
      records.some((record) => record.sourceKey === "settings.presets.applied")
    ).toBe(false)
  })

  it("returns matched child text instead of only the parent heading", () => {
    const records = buildSettingsSearchRecords(entries, t)
    const [hit] = rankSettingsSearchRecords("balanced", records)
    expect(hit.record.displayLabel).toBe("Balanced")
    expect(hit.record.entryId).toBe("settings-presets")
  })

  it("maps canonical control concepts to their real control, not preset mirrors", () => {
    const records = buildSettingsSearchRecords(entries, t)
    const [hit] = rankSettingsSearchRecords("character budget", records)
    expect(hit.record.entryId).toBe("max-tab-context-chars")
    expect(hit.record.tab).toBe("context")
  })

  it("caps crowded records per focus id", () => {
    const records = buildSettingsSearchRecords(entries, t)
    const hits = rankSettingsSearchRecords("preset response context", records)
    const presetHits = hits.filter(
      (hit) => hit.record.focusId === "settings-presets"
    )
    expect(presetHits.length).toBeLessThanOrEqual(2)
  })

  it("supports active-language text from the injected translator", () => {
    const localeT = (key: string) =>
      key === "settings.presets.balanced.label" ? "Equilibrado" : t(key)
    const records = buildSettingsSearchRecords(entries, localeT)
    const [hit] = rankSettingsSearchRecords("equilibrado", records)
    expect(hit.record.displayLabel).toBe("Equilibrado")
  })
})
