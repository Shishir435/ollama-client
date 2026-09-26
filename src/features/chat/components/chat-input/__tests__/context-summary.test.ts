import { describe, expect, it } from "vitest"

import { buildContextSummary, countContextSources } from "../context-summary"

const t = (key: string, options?: Record<string, unknown>) =>
  options?.count === undefined ? key : `${key}:${options.count}`

const base = {
  tabAccess: false,
  selectedTabCount: 0,
  fileCount: 0,
  imageCount: 0,
  useRAG: false,
  webSearchActive: false,
  showWebSearch: false
}

describe("buildContextSummary", () => {
  it("says so explicitly when nothing is in context", () => {
    expect(buildContextSummary(base, t)).toBe("chat.context.none")
  })

  it("names the current page when tab access is on with no selection", () => {
    expect(buildContextSummary({ ...base, tabAccess: true }, t)).toBe(
      "chat.context.page"
    )
  })

  it("counts selected tabs instead of naming the page", () => {
    expect(
      buildContextSummary({ ...base, tabAccess: true, selectedTabCount: 3 }, t)
    ).toBe("chat.context.tabs:3")
  })

  it("lets attachments displace the knowledge label", () => {
    // Staged files are what RAG would retrieve from, so showing both would read
    // as two separate context sources.
    expect(
      buildContextSummary({ ...base, useRAG: true, fileCount: 2 }, t)
    ).toBe("chat.context.files:2")
    expect(buildContextSummary({ ...base, useRAG: true }, t)).toBe(
      "chat.context.knowledge"
    )
  })

  it("ignores an active web search that is not configured", () => {
    expect(buildContextSummary({ ...base, webSearchActive: true }, t)).toBe(
      "chat.context.none"
    )
    expect(
      buildContextSummary(
        { ...base, webSearchActive: true, showWebSearch: true },
        t
      )
    ).toBe("chat.context.web")
  })

  it("joins the sources in prompt order", () => {
    expect(
      buildContextSummary(
        {
          tabAccess: true,
          selectedTabCount: 2,
          fileCount: 1,
          imageCount: 0,
          useRAG: true,
          webSearchActive: true,
          showWebSearch: true
        },
        t
      )
    ).toBe("chat.context.tabs:2 · chat.context.files:1 · chat.context.web")
  })
})

describe("countContextSources", () => {
  const none = {
    tabAccess: false,
    selectedTabCount: 0,
    fileCount: 0,
    imageCount: 0,
    useRAG: false,
    webSearchActive: false,
    showWebSearch: false
  }

  it("counts nothing when everything is at its default", () => {
    expect(countContextSources(none)).toBe(0)
  })

  it("counts each attachment as an item, files displacing knowledge", () => {
    /**
     * Files displace the knowledge label rather than adding to it, so the
     * badge and the sentence inside the sheet read the same parts — but each
     * staged file is its own item within that part.
     */
    expect(countContextSources({ ...none, fileCount: 2, useRAG: true })).toBe(2)
    expect(
      countContextSources({
        ...none,
        tabAccess: true,
        fileCount: 2,
        showWebSearch: true,
        webSearchActive: true
      })
    ).toBe(4)
  })

  /**
   * Reported from the panel: page, file search and web search on, one image
   * attached, and the badge read 3 — the image had hidden knowledge instead
   * of adding to it. File search never retrieves an image.
   */
  it("counts every attached image as one item beside knowledge", () => {
    const withSources = {
      ...none,
      tabAccess: true,
      useRAG: true,
      showWebSearch: true,
      webSearchActive: true
    }
    expect(countContextSources(withSources)).toBe(3)
    expect(countContextSources({ ...withSources, imageCount: 1 })).toBe(4)
    expect(countContextSources({ ...none, imageCount: 4 })).toBe(4)
    expect(buildContextSummary({ ...withSources, imageCount: 1 }, t)).toBe(
      "chat.context.page · chat.context.knowledge · chat.context.images:1 · chat.context.web"
    )
  })
})
