import { afterEach, describe, expect, it, vi } from "vitest"

import { runCurrentTab } from "../current-tab-tool"
import { runFileSearch } from "../file-search-tool"
import { runListTabs } from "../list-tabs-tool"
import { runReadTab } from "../read-tab-tool"
import { runSelectedText } from "../selected-text-tool"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: { query: vi.fn(), sendMessage: vi.fn() },
    scripting: { executeScript: vi.fn() }
  }
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
import { browser } from "@/lib/browser-api"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"

const ctx = {}

describe("current_tab tool", () => {
  afterEach(() => vi.clearAllMocks())

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

  it("explains gracefully (not an error) on a restricted internal page", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 7, title: "Settings", url: "chrome://settings", active: true }
    ] as never)
    const result = await runCurrentTab({}, ctx)
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain("internal pages")
    // Never attempts to read a page it can't access.
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled()
  })
})

describe("list_tabs tool", () => {
  afterEach(() => vi.clearAllMocks())

  it("lists readable tabs and skips browser-internal pages", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, title: "Wiki", url: "https://wiki.test", active: true },
      { id: 2, title: "Vid", url: "https://youtube.test" },
      { id: 3, title: "Settings", url: "chrome://settings" }
    ] as never)

    const result = await runListTabs({}, ctx)
    expect(result.content).toContain("id=1")
    expect(result.content).toContain("(active)")
    expect(result.content).toContain("id=2")
    expect(result.content).not.toContain("chrome://settings")
  })
})

describe("read_tab tool", () => {
  afterEach(() => vi.clearAllMocks())

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
