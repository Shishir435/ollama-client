import { afterEach, describe, expect, it, vi } from "vitest"

import { runCurrentTab } from "../current-tab-tool"
import { runFileSearch } from "../file-search-tool"
import { runSelectedText } from "../selected-text-tool"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: { query: vi.fn(), sendMessage: vi.fn() }
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn()
}))

vi.mock("@/features/chat/rag/rag-pipeline", () => ({
  retrieveContextEnhanced: vi.fn(),
  formatEnhancedResults: vi.fn()
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

  it("errors cleanly when the content script is unreachable", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 7 }] as never)
    vi.mocked(browser.tabs.sendMessage).mockRejectedValue(
      new Error("no receiver")
    )
    const result = await runCurrentTab({}, ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain("no receiver")
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
