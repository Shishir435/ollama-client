import { afterEach, describe, expect, it, vi } from "vitest"
import {
  runRecentHistory,
  runSearchBookmarks
} from "../browser-knowledge-tools"
import { runCurrentTab } from "../current-tab-tool"
import { runFileSearch } from "../file-search-tool"
import { createInternalToolSource } from "../internal-tool-source"
import { runListTabs } from "../list-tabs-tool"
import { runReadTab } from "../read-tab-tool"
import { runSelectedText } from "../selected-text-tool"
import { runListTabGroups, runReadTabGroup } from "../tab-group-tools"
import { clearTabContentCache } from "../tab-utils"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: { get: vi.fn(), query: vi.fn(), sendMessage: vi.fn() },
    bookmarks: { search: vi.fn() },
    history: { search: vi.fn() },
    scripting: { executeScript: vi.fn() }
  },
  supportsAlarms: vi.fn(() => true),
  supportsBookmarks: vi.fn(() => true),
  supportsHistory: vi.fn(() => true),
  supportsTabGroups: vi.fn(() => true)
}))

vi.mock("@/lib/permissions", () => ({
  hasPermission: vi.fn()
}))

vi.mock("@/lib/browser-tab-groups", () => ({
  getTabGroupsAvailability: vi.fn(),
  listAvailableBrowserTabGroups: vi.fn(),
  listBrowserTabGroups: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn()
}))

vi.mock("@/features/chat/rag/rag-pipeline", () => ({
  retrieveContextEnhanced: vi.fn(),
  formatEnhancedResults: vi.fn()
}))

// Isolate the tab tools from storage-backed exclusion resolution.
vi.mock("@/contents/url-filter", () => ({
  resolveExcludedUrlPatterns: vi.fn(async () => []),
  urlMatchesAny: vi.fn(() => false)
}))

import {
  formatEnhancedResults,
  retrieveContextEnhanced
} from "@/features/chat/rag/rag-pipeline"
import { browser, supportsTabGroups } from "@/lib/browser-api"
import {
  getTabGroupsAvailability,
  listAvailableBrowserTabGroups,
  listBrowserTabGroups
} from "@/lib/browser-tab-groups"
import { hasPermission } from "@/lib/permissions"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"

const ctx = {}

describe("current_tab tool", () => {
  afterEach(() => {
    clearTabContentCache()
    vi.clearAllMocks()
  })

  it("returns the extracted page text with the tab as a source", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 7, title: "Docs", url: "https://x.test" }
    ] as never)
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({
      html: "page body",
      title: "Docs"
    } as never)

    const result = await runCurrentTab({}, ctx)
    expect(result.content).toBe("page body")
    expect(result.sources?.[0]).toEqual({
      title: "Docs",
      url: "https://x.test"
    })
  })

  it("errors cleanly when there is no active tab", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([] as never)
    const result = await runCurrentTab({}, ctx)
    expect(result.isError).toBe(true)
  })

  it("injects the content script and retries when there is no receiver", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 7, title: "Vid", url: "https://youtube.test" }
    ] as never)
    // First send fails (stale tab); after injection the retry succeeds.
    vi.mocked(browser.tabs.sendMessage)
      .mockRejectedValueOnce(new Error("Receiving end does not exist"))
      .mockResolvedValueOnce({ html: "transcript", title: "Vid" } as never)
    vi.mocked(browser.scripting.executeScript).mockResolvedValue([] as never)

    const result = await runCurrentTab({}, ctx)
    expect(browser.scripting.executeScript).toHaveBeenCalledTimes(1)
    expect(result.content).toBe("transcript")
  })

  it("reuses cached tab content when the tab URL and title are unchanged", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 7, title: "Docs", url: "https://docs.test" }
    ] as never)
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 7,
      title: "Docs",
      url: "https://docs.test"
    } as never)
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({
      html: "cached body",
      title: "Docs"
    } as never)

    const first = await runCurrentTab({}, ctx)
    const second = await runCurrentTab({}, ctx)

    expect(first.content).toBe("cached body")
    expect(second.content).toBe("cached body")
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1)
  })

  it("bypasses cached tab content when force is true", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 7, title: "Docs", url: "https://docs.test" }
    ] as never)
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 7,
      title: "Docs",
      url: "https://docs.test"
    } as never)
    vi.mocked(browser.tabs.sendMessage)
      .mockResolvedValueOnce({ html: "old body", title: "Docs" } as never)
      .mockResolvedValueOnce({ html: "fresh body", title: "Docs" } as never)

    const first = await runCurrentTab({}, ctx)
    const second = await runCurrentTab({ force: true }, ctx)

    expect(first.content).toBe("old body")
    expect(second.content).toBe("fresh body")
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(2)
  })

  it("returns a clean error when the injected content script retry fails", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 7, title: "Loading", url: "https://example.test" }
    ] as never)
    vi.mocked(browser.tabs.sendMessage)
      .mockRejectedValueOnce(new Error("Receiving end does not exist"))
      .mockRejectedValueOnce(new Error("Tab is navigating"))
    vi.mocked(browser.scripting.executeScript).mockResolvedValue([] as never)

    const result = await runCurrentTab({}, ctx)
    expect(browser.scripting.executeScript).toHaveBeenCalledTimes(1)
    expect(result.isError).toBe(true)
    expect(result.content).toContain("Tab is navigating")
  })

  it("errors clearly on a restricted internal page", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 7, title: "Settings", url: "chrome://settings", active: true }
    ] as never)
    const result = await runCurrentTab({}, ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain("internal pages")
    // Never attempts to read a page it can't access.
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it("errors clearly on Chrome Web Store pages without injecting", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        id: 7,
        title: "Ollama Client - Chrome Web Store",
        url: "https://chromewebstore.google.com/detail/example",
        active: true
      }
    ] as never)

    const result = await runCurrentTab({}, ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain("Chrome Web Store")
    expect(result.content).toContain("Do not retry")
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled()
    expect(browser.scripting.executeScript).not.toHaveBeenCalled()
  })
})

describe("list_tabs tool", () => {
  afterEach(() => {
    clearTabContentCache()
    vi.clearAllMocks()
  })

  it("lists readable tabs and skips browser-internal/store pages", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, title: "Wiki", url: "https://wiki.test", active: true },
      { id: 2, title: "Vid", url: "https://youtube.test" },
      { id: 3, title: "Settings", url: "chrome://settings" },
      {
        id: 4,
        title: "Chrome Web Store",
        url: "https://chromewebstore.google.com/detail/example"
      }
    ] as never)

    const result = await runListTabs({}, ctx)
    expect(result.content).toContain("id=1")
    expect(result.content).toContain("(active)")
    expect(result.content).toContain("id=2")
    expect(result.content).not.toContain("chrome://settings")
    expect(result.content).not.toContain("Chrome Web Store")
  })
})

describe("tab group tools", () => {
  afterEach(() => {
    clearTabContentCache()
    vi.clearAllMocks()
  })

  const groups = [
    {
      id: 4,
      title: "Research",
      tabs: [
        {
          id: 11,
          title: "Docs",
          url: "https://docs.test",
          active: false
        },
        {
          id: 12,
          title: "Notes",
          url: "https://notes.test",
          active: false
        }
      ],
      skipped: 1
    }
  ]

  it("lists readable browser tab groups", async () => {
    vi.mocked(getTabGroupsAvailability).mockResolvedValue("available")
    vi.mocked(listAvailableBrowserTabGroups).mockResolvedValue(groups)

    const result = await runListTabGroups({}, ctx)

    expect(result.content).toContain("groupId=4")
    expect(result.content).toContain("Research")
    expect(result.content).toContain("skipped=1")
  })

  it("reads readable tabs from a tab group", async () => {
    vi.mocked(getTabGroupsAvailability).mockResolvedValue("available")
    vi.mocked(listAvailableBrowserTabGroups).mockResolvedValue(groups)
    vi.mocked(browser.tabs.get).mockImplementation(
      async (id) =>
        ({
          id,
          title: id === 11 ? "Docs" : "Notes",
          url: id === 11 ? "https://docs.test" : "https://notes.test"
        }) as never
    )
    vi.mocked(browser.tabs.sendMessage)
      .mockResolvedValueOnce({ html: "docs body", title: "Docs" } as never)
      .mockResolvedValueOnce({ html: "notes body", title: "Notes" } as never)

    const result = await runReadTabGroup({ groupId: 4 }, ctx)

    expect(result.content).toContain("Tab group: Research")
    expect(result.content).toContain("docs body")
    expect(result.content).toContain("notes body")
    expect(result.content).toContain("Skipped 1")
    expect(result.sources).toHaveLength(2)
  })

  it("reports permission state before listing groups", async () => {
    vi.mocked(getTabGroupsAvailability).mockResolvedValue("permission")

    const result = await runListTabGroups({}, ctx)

    expect(result.isError).toBe(true)
    expect(result.content).toContain("Settings > Permissions")
    expect(listAvailableBrowserTabGroups).not.toHaveBeenCalled()
    expect(listBrowserTabGroups).not.toHaveBeenCalled()
  })

  it("returns an error if tab groups fail after availability is confirmed", async () => {
    vi.mocked(getTabGroupsAvailability).mockResolvedValue("available")
    vi.mocked(listAvailableBrowserTabGroups).mockRejectedValue(
      new Error("permission revoked")
    )

    const result = await runListTabGroups({}, ctx)

    expect(result.isError).toBe(true)
    expect(result.content).toContain("permission revoked")
  })

  it("exposes tab-group tools when supported even before permission is granted", async () => {
    vi.mocked(supportsTabGroups).mockReturnValue(true)
    vi.mocked(hasPermission).mockResolvedValue(false)

    const source = createInternalToolSource()
    const names = (await source.listTools()).map((tool) => tool.name)

    expect(names).toContain("list_tab_groups")
    expect(names).toContain("read_tab_group")
  })
})

describe("read_tab tool", () => {
  afterEach(() => {
    clearTabContentCache()
    vi.clearAllMocks()
  })

  const openTabs = [
    { id: 1, title: "Wiki", url: "https://wiki.test", active: true },
    {
      id: 2,
      title: "Theo video",
      url: "https://youtube.test/watch",
      active: false
    }
  ]

  it("reads a tab matched by a title/url query", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue(openTabs as never)
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({
      html: "video transcript",
      title: "Theo video"
    } as never)

    const result = await runReadTab({ query: "youtube" }, ctx)
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(2, expect.anything())
    expect(result.content).toContain("video transcript")
  })

  it("reads a tab by explicit id", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue(openTabs as never)
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({
      html: "wiki body",
      title: "Wiki"
    } as never)

    const result = await runReadTab({ tabId: 1 }, ctx)
    expect(result.content).toContain("wiki body")
  })

  it("reads a tab by string id from a model tool call", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue(openTabs as never)
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({
      html: "video transcript",
      title: "Theo video"
    } as never)

    const result = await runReadTab({ tabId: "2" }, ctx)
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(2, expect.anything())
    expect(result.content).toContain("video transcript")
  })

  it("bypasses cached read_tab content when force is true", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue(openTabs as never)
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 2,
      title: "Theo video",
      url: "https://youtube.test/watch"
    } as never)
    vi.mocked(browser.tabs.sendMessage)
      .mockResolvedValueOnce({
        html: "old transcript",
        title: "Theo video"
      } as never)
      .mockResolvedValueOnce({
        html: "fresh transcript",
        title: "Theo video"
      } as never)

    const first = await runReadTab({ tabId: 2 }, ctx)
    const second = await runReadTab({ tabId: 2, force: true }, ctx)

    expect(first.content).toContain("old transcript")
    expect(second.content).toContain("fresh transcript")
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(2)
  })

  it("errors instead of reading the active tab when a model uses a stale tab id", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue(openTabs as never)

    const result = await runReadTab({ tabId: 999 }, ctx)
    expect(result.isError).toBe(true)
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled()
    expect(result.content).toContain("Tab id 999 is no longer open")
    expect(result.content).toContain("Call list_tabs")
    expect(result.content).toContain("id=1: Wiki")
  })

  it("errors cleanly when a stale id has no current readable tabs", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        id: 7,
        title: "Docs",
        url: "https://docs.test",
        active: false
      }
    ] as never)

    const result = await runReadTab({ tabId: 999 }, ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain("current readable tabs")
    expect(result.content).toContain("id=7: Docs")
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it("errors with the open-tab list when nothing matches", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue(openTabs as never)
    const result = await runReadTab({ query: "nonexistent" }, ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain("Wiki")
  })

  it("requires a tabId or query", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue(openTabs as never)
    const result = await runReadTab({}, ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain("current_tab")
  })

  it("explains rather than reads when the target is an internal page", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 9, title: "Extensions", url: "chrome://extensions", active: false }
    ] as never)
    const result = await runReadTab({ tabId: 9 }, ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain("internal pages")
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled()
  })
})

describe("selected_text tool", () => {
  afterEach(() => vi.clearAllMocks())

  it("returns the stored selection", async () => {
    vi.mocked(getPlasmoStoredValue).mockResolvedValue("highlighted bit")
    expect((await runSelectedText({}, ctx)).content).toBe("highlighted bit")
  })

  it("reports an empty selection without erroring", async () => {
    vi.mocked(getPlasmoStoredValue).mockResolvedValue(undefined)
    const result = await runSelectedText({}, ctx)
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain("No text")
  })
})

describe("browser knowledge tools", () => {
  afterEach(() => vi.clearAllMocks())

  it("returns recent browser history with the requested limit", async () => {
    vi.mocked(hasPermission).mockResolvedValue(true)
    vi.mocked(getPlasmoStoredValue).mockResolvedValue({
      sources: {
        history: {
          enabled: true,
          maxItems: 10,
          sinceDays: 30,
          includeDomains: [],
          excludeDomains: []
        }
      }
    })
    vi.mocked(browser.history.search).mockResolvedValue([
      {
        id: "1",
        title: "Docs",
        url: "https://docs.test",
        lastVisitTime: 1710000000000,
        visitCount: 2
      }
    ] as never)

    const result = await runRecentHistory({ limit: 10 }, ctx)

    expect(browser.history.search).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        startTime: expect.any(Number),
        maxResults: 10
      })
    )
    expect(result.content).toContain("Recent browser history")
    expect(result.content).toContain("Docs")
    expect(result.sources?.[0]).toEqual({
      title: "Docs",
      url: "https://docs.test"
    })
  })

  it("reports unavailable history when permission is off", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false)
    vi.mocked(getPlasmoStoredValue).mockResolvedValue({
      sources: {
        history: {
          enabled: true,
          maxItems: 10,
          sinceDays: 30,
          includeDomains: [],
          excludeDomains: []
        }
      }
    })

    const result = await runRecentHistory({ limit: 10 }, ctx)

    expect(result.content).toContain("permission may be off")
    expect(browser.history.search).not.toHaveBeenCalled()
  })

  it("tells the user when history knowledge is disabled", async () => {
    vi.mocked(hasPermission).mockResolvedValue(true)
    vi.mocked(getPlasmoStoredValue).mockResolvedValue({
      sources: {
        history: {
          enabled: false,
          maxItems: 10,
          sinceDays: 30,
          includeDomains: [],
          excludeDomains: []
        }
      }
    })

    const result = await runRecentHistory({ limit: 10 }, ctx)

    expect(result.isError).toBe(true)
    expect(result.content).toContain("Browsing history knowledge is disabled")
    expect(browser.history.search).not.toHaveBeenCalled()
  })

  it("searches bookmarks by query", async () => {
    vi.mocked(hasPermission).mockResolvedValue(true)
    vi.mocked(getPlasmoStoredValue).mockResolvedValue({
      sources: {
        bookmarks: {
          enabled: true,
          maxItems: 10,
          includeDomains: [],
          excludeDomains: []
        }
      }
    })
    vi.mocked(browser.bookmarks.search).mockResolvedValue([
      { id: "b1", title: "Saved Docs", url: "https://docs.test" }
    ] as never)

    const result = await runSearchBookmarks({ query: "docs", limit: 5 }, ctx)

    expect(browser.bookmarks.search).toHaveBeenCalledWith("docs")
    expect(result.content).toContain("Matching bookmarks")
    expect(result.content).toContain("Saved Docs")
  })

  it("tells the user when bookmark knowledge is disabled", async () => {
    vi.mocked(hasPermission).mockResolvedValue(true)
    vi.mocked(getPlasmoStoredValue).mockResolvedValue({
      sources: {
        bookmarks: {
          enabled: false,
          maxItems: 10,
          includeDomains: [],
          excludeDomains: []
        }
      }
    })

    const result = await runSearchBookmarks({ query: "docs", limit: 5 }, ctx)

    expect(result.isError).toBe(true)
    expect(result.content).toContain("Bookmark knowledge is disabled")
    expect(browser.bookmarks.search).not.toHaveBeenCalled()
  })
})

describe("file_search tool", () => {
  afterEach(() => vi.clearAllMocks())

  it("searches documents only (type: file) and formats results", async () => {
    vi.mocked(retrieveContextEnhanced).mockResolvedValue([{}] as never)
    vi.mocked(formatEnhancedResults).mockReturnValue({
      documents: [],
      formattedContext: "<doc>found</doc>",
      sources: [{ id: 1, title: "report.pdf", content: "abc", score: 1 }]
    } as never)

    const result = await runFileSearch({ query: "budget" }, ctx)
    expect(retrieveContextEnhanced).toHaveBeenCalledWith("budget", {
      type: "file"
    })
    expect(result.content).toBe("<doc>found</doc>")
    expect(result.sources?.[0].title).toBe("report.pdf")
  })

  it("rejects an empty query", async () => {
    const result = await runFileSearch({ query: "  " }, ctx)
    expect(result.isError).toBe(true)
    expect(retrieveContextEnhanced).not.toHaveBeenCalled()
  })

  it("reports no matches without erroring", async () => {
    vi.mocked(retrieveContextEnhanced).mockResolvedValue([] as never)
    const result = await runFileSearch({ query: "x" }, ctx)
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain("No matching documents")
  })
})
