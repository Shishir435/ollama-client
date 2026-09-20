import { describe, expect, it } from "vitest"

import { buildContextSummary, countContextSources } from "../context-summary"

const t = (key: string, options?: Record<string, unknown>) =>
  options?.count === undefined ? key : `${key}:${options.count}`

const base = {
  tabAccess: false,
  selectedTabCount: 0,
  attachmentCount: 0,
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
      buildContextSummary({ ...base, useRAG: true, attachmentCount: 2 }, t)
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
          attachmentCount: 1,
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
    attachmentCount: 0,
    useRAG: false,
    webSearchActive: false,
    showWebSearch: false
  }

  it("counts nothing when everything is at its default", () => {
    expect(countContextSources(none)).toBe(0)
  })

  it("counts the sources the summary names, and no more", () => {
    /*
     * Files displace the knowledge label rather than adding to it, so the two
     * are one source. The badge and the sentence inside the sheet read the
     * same rules for that reason.
     */
    expect(
      countContextSources({ ...none, attachmentCount: 2, useRAG: true })
    ).toBe(1)
    expect(
      countContextSources({
        ...none,
        tabAccess: true,
        attachmentCount: 2,
        showWebSearch: true,
        webSearchActive: true
      })
    ).toBe(3)
  })
})
