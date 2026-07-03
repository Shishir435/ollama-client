import { describe, expect, it } from "vitest"
import {
  getSectionEntries,
  getSettingsEntry,
  getSettingsForTab,
  isSettingsTab,
  rankSettings,
  resolveSettingsTab,
  SETTINGS_REGISTRY,
  SETTINGS_TABS,
  searchSettings
} from "../settings-registry"

describe("settings-registry", () => {
  it("uses six intent tabs and redirects legacy deep links", () => {
    expect(SETTINGS_TABS).toHaveLength(6)
    expect(resolveSettingsTab("providers")).toBe("models")
    expect(resolveSettingsTab("saved-knowledge")).toBe("knowledge")
    expect(resolveSettingsTab("data-backup")).toBe("privacy")
  })

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
    expect(getSettingsEntry("grounded-only-mode")?.tab).toBe("knowledge")
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
      expect(hit?.tab).toBe("knowledge")
    })

    it("matches by id words", () => {
      const results = searchSettings("grounded only")
      expect(results.map((e) => e.id)).toContain("grounded-only-mode")
    })

    it("uses prefix matching in the compatibility wrapper", () => {
      expect(searchSettings("pres").map((e) => e.id)).toContain(
        "settings-presets"
      )
    })

    it("matches selection actions to the content extraction tab", () => {
      const results = searchSettings("selection actions")
      const hit = results.find((e) => e.id === "selection-actions-enabled")
      expect(hit?.tab).toBe("browser")
    })

    it("matches reset module rows", () => {
      const results = searchSettings("browser settings")
      const hit = results.find((e) => e.id === "reset-browser")
      expect(hit?.tab).toBe("privacy")
    })

    it("matches non-model tabs that were easy to miss", () => {
      expect(searchSettings("prompt templates").map((e) => e.id)).toContain(
        "prompt-templates"
      )
      expect(searchSettings("keyboard shortcuts").map((e) => e.id)).toContain(
        "keyboard-shortcuts"
      )
      expect(searchSettings("setup guide").map((e) => e.id)).toContain(
        "guide-setup"
      )
    })

    it("matches embedding search internals on the embeddings tab", () => {
      expect(searchSettings("semantic search").map((e) => e.id)).toContain(
        "embeddings-test-search"
      )
      // The old "embeddings-search" advanced card is gone; its registry
      // entries were removed so search never points at unmounted controls.
      expect(searchSettings("search cache ttl").map((e) => e.id)).not.toContain(
        "embeddings-cache-ttl"
      )
      expect(searchSettings("ann backend").map((e) => e.id)).not.toContain(
        "embeddings-ann-backend"
      )
    })

    it("matches privacy and plain-language context aliases", () => {
      expect(searchSettings("stop ai seeing tabs").map((e) => e.id)).toContain(
        "browser-tab-access"
      )
      expect(searchSettings("auto screenshot").map((e) => e.id)).toContain(
        "auto-screenshot-on-vision"
      )
      expect(searchSettings("document search").map((e) => e.id)).toContain(
        "rag-enabled"
      )
      expect(searchSettings("page reading").map((e) => e.id)).toContain(
        "content-extraction-enabled"
      )
    })

    it("matches reset danger zone separately from module rows", () => {
      const hit = searchSettings("danger zone").find(
        (e) => e.id === "reset-danger-zone"
      )
      expect(hit?.tab).toBe("privacy")
      expect(hit?.destructive).toBe(true)
    })

    it("keeps useful partial matches instead of strict AND misses", () => {
      expect(searchSettings("temperature").map((e) => e.id)).toContain(
        "temperature"
      )
      expect(searchSettings("temperature voice").map((e) => e.id)).toContain(
        "temperature"
      )
      expect(searchSettings("prese").map((e) => e.id)).toContain(
        "settings-presets"
      )
      expect(searchSettings("preset").map((e) => e.id)).toContain(
        "settings-presets"
      )
    })

    it("can match resolved label text via a translator", () => {
      const translate = (key: string) =>
        key === "settings.grounding_mode.label" ? "Answer only from page" : key
      const results = searchSettings("answer only from page", translate)
      expect(results.map((e) => e.id)).toContain("grounded-only-mode")
    })

    it("matches fuzzy provider and settings queries", () => {
      expect(searchSettings("provder").map((e) => e.id)).toContain(
        "provider-picker"
      )
      expect(searchSettings("ollma").map((e) => e.id)).toContain(
        "provider-picker"
      )
      expect(searchSettings("base url").map((e) => e.id)).toContain(
        "provider-base-url"
      )
      expect(searchSettings("api").map((e) => e.id)).toContain(
        "provider-api-key"
      )
    })

    it("ranks exact phrase matches above loose partial matches", () => {
      const results = rankSettings("base url")
      expect(results[0].entry.id).toBe("provider-base-url")
      expect(results[0].score).toBeGreaterThan(0)
    })

    it("returns [] for unrelated queries", () => {
      expect(searchSettings("zzzzqqqq nowhere")).toEqual([])
    })
  })
})
