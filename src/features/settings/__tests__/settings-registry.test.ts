import { describe, expect, it } from "vitest"
import {
  getSectionEntries,
  getSettingsEntry,
  getSettingsForTab,
  isSettingsTab,
  SETTINGS_REGISTRY,
  SETTINGS_TABS,
  searchSettings
} from "../settings-registry"

describe("settings-registry", () => {
  it("has no duplicate ids", () => {
    const ids = SETTINGS_REGISTRY.map((entry) => entry.id)
    const unique = new Set(ids)
    // Report the offenders, not just a count mismatch.
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes).toEqual([])
    expect(unique.size).toBe(ids.length)
  })

  it("uses kebab-case ids", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(entry.id, entry.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it("references only real tab keys", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(isSettingsTab(entry.tab), `${entry.id} -> ${entry.tab}`).toBe(true)
    }
  })

  it("gives every entry a label key", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(entry.labelKey, entry.id).toBeTruthy()
    }
  })

  it("getSettingsForTab returns only that tab's entries", () => {
    for (const tab of SETTINGS_TABS) {
      const entries = getSettingsForTab(tab)
      for (const entry of entries) expect(entry.tab).toBe(tab)
    }
    // Every entry is reachable through some tab.
    const viaTabs = SETTINGS_TABS.flatMap((tab) => getSettingsForTab(tab))
    expect(viaTabs).toHaveLength(SETTINGS_REGISTRY.length)
  })

  it("getSectionEntries groups by sectionId", () => {
    const promptBudget = getSectionEntries("prompt-budget")
    expect(promptBudget.map((e) => e.id)).toContain("max-tool-result-chars")
    for (const entry of promptBudget)
      expect(entry.sectionId).toBe("prompt-budget")
  })

  it("getSettingsEntry finds by id", () => {
    expect(getSettingsEntry("grounded-only-mode")?.tab).toBe("context")
    expect(getSettingsEntry("does-not-exist")).toBeUndefined()
  })

  describe("searchSettings", () => {
    it("returns [] for an empty query", () => {
      expect(searchSettings("")).toEqual([])
      expect(searchSettings("   ")).toEqual([])
    })

    it("matches by keyword and returns id + tab", () => {
      const results = searchSettings("tool result")
      const hit = results.find((e) => e.id === "max-tool-result-chars")
      expect(hit).toBeDefined()
      expect(hit?.tab).toBe("context")
    })

    it("matches by id words", () => {
      const results = searchSettings("grounded only")
      expect(results.map((e) => e.id)).toContain("grounded-only-mode")
    })

    it("matches selection actions to the content extraction tab", () => {
      const results = searchSettings("selection actions")
      const hit = results.find((e) => e.id === "selection-actions-enabled")
      expect(hit?.tab).toBe("contentExtraction")
    })

    it("requires all tokens (AND semantics)", () => {
      // 'temperature' exists; 'temperature voice' should not match it.
      expect(searchSettings("temperature").map((e) => e.id)).toContain(
        "temperature"
      )
      expect(searchSettings("temperature voice")).toEqual([])
    })

    it("can match resolved label text via a translator", () => {
      const translate = (key: string) =>
        key === "settings.grounding_mode.label" ? "Answer only from page" : key
      const results = searchSettings("answer only from page", translate)
      expect(results.map((e) => e.id)).toContain("grounded-only-mode")
    })
  })
})
