import { describe, expect, it } from "vitest"
import {
  classifyCodexError,
  collectCodexSources,
  MAX_CODEX_SOURCES,
  readCodexContextWindow,
  readCodexUsage,
  retryAfterFromRateLimits
} from "../evidence.js"

/**
 * Trimmed from a live `codex app-server` turn (codex-cli 0.160.0) asked for the
 * latest Node.js LTS: one search, one opened page, then the answer.
 */
const SEARCH_ITEM = {
  type: "webSearch",
  id: "exec-1",
  query: "site:nodejs.org latest LTS release",
  action: {
    type: "search",
    query: null,
    queries: ["site:nodejs.org latest LTS release"]
  },
  results: [
    {
      type: "text_result",
      domain: "nodejs.org",
      ref_id: "turn0search0",
      snippet: "Node.js 26 will enter long-term support (LTS) in October",
      title: "Node.js — Node.js 26.0.0 (Current)",
      url: "https://nodejs.org/en/blog/release/v26.0.0/"
    },
    {
      type: "text_result",
      domain: "nodejs.org",
      ref_id: "turn0search5",
      snippet: "# Node.js 16.14.0 (LTS)",
      title: "Node.js — Node.js 16.14.0 (LTS)",
      url: "https://nodejs.org/en/blog/release/v16.14.0/"
    },
    { type: "text_result", title: "No url" },
    { type: "text_result", url: "javascript:alert(1)", title: "Not a page" }
  ]
}

const OPEN_ITEM = {
  type: "webSearch",
  id: "exec-2",
  query: "https://nodejs.org/en",
  action: { type: "openPage", url: "https://nodejs.org/en" },
  results: [
    {
      type: "text_result",
      domain: "nodejs.org",
      ref_id: "turn1view0",
      snippet: "Total lines: 102",
      title: "Node.js — Run JavaScript Everywhere",
      url: "https://nodejs.org/en"
    },
    {
      type: "text_result",
      domain: "nodejs.org",
      ref_id: "turn1view1",
      snippet: "Total lines: 350",
      title: "Node.js — Node.js 24.21.0 (LTS)",
      url: "https://nodejs.org/en/blog/release/v24.21.0"
    }
  ]
}

const ANSWER =
  "The latest Node.js LTS release is **v24.21.0**. Its [official release notes](https://nodejs.org/en/blog/release/v24.21.0) date the release **September 8, 2026**."

describe("Codex usage", () => {
  it("reads a TokenUsageBreakdown in OpenAI's terms", () => {
    expect(
      readCodexUsage({
        inputTokens: 9000,
        cachedInputTokens: 6000,
        outputTokens: 400,
        reasoningOutputTokens: 120,
        totalTokens: 9400
      })
    ).toEqual({
      promptTokens: 9000,
      completionTokens: 400,
      cachedPromptTokens: 6000,
      reasoningTokens: 120
    })
  })

  it("leaves out zero detail counts and rejects a non-object", () => {
    expect(readCodexUsage({ inputTokens: 10, outputTokens: 2 })).toEqual({
      promptTokens: 10,
      completionTokens: 2
    })
    expect(readCodexUsage(null)).toBeNull()
  })

  it("reads the context window only when it is a positive integer", () => {
    expect(readCodexContextWindow({ modelContextWindow: 272000 })).toBe(272000)
    expect(readCodexContextWindow({ modelContextWindow: null })).toBeNull()
    expect(readCodexContextWindow({ modelContextWindow: 0 })).toBeNull()
  })
})

describe("Codex sources", () => {
  it("lists the cited page first, then opened pages, and no unread hits", () => {
    expect(collectCodexSources([SEARCH_ITEM, OPEN_ITEM], ANSWER)).toEqual([
      {
        url: "https://nodejs.org/en/blog/release/v24.21.0",
        title: "Node.js — Node.js 24.21.0 (LTS)"
      },
      {
        url: "https://nodejs.org/en",
        title: "Node.js — Run JavaScript Everywhere"
      }
    ])
  })

  it("falls back to the top search hits when nothing was cited or opened", () => {
    expect(collectCodexSources([SEARCH_ITEM], "No links here.")).toEqual([
      {
        url: "https://nodejs.org/en/blog/release/v26.0.0/",
        title: "Node.js — Node.js 26.0.0 (Current)"
      },
      {
        url: "https://nodejs.org/en/blog/release/v16.14.0/",
        title: "Node.js — Node.js 16.14.0 (LTS)"
      }
    ])
  })

  it("cites a page linked bare, at the end of a sentence, or without its slash", () => {
    const hit = (url: string) => ({
      type: "webSearch",
      action: { type: "search" },
      results: [{ url }]
    })
    const items = [
      hit("https://a.example/x"),
      hit("https://b.example/"),
      hit("https://a.example/x/deeper")
    ]
    expect(
      collectCodexSources(
        items,
        "See https://a.example/x. Also https://b.example"
      )
    ).toEqual([{ url: "https://a.example/x" }, { url: "https://b.example/" }])
  })

  /**
   * The shape a live gpt-6-luna turn produced: the answer linked a release page
   * no result listed, on the site its search returned, and nothing was opened.
   * Falling back to the top hits instead listed a stale release and left out
   * the page the answer used.
   */
  it("cites an answer link on a site the search returned, but not one elsewhere", () => {
    const answer =
      "The latest LTS is v24.21.0 ([release notes](https://nodejs.org/en/blog/release/v24.21.0)); see also https://elsewhere.example/post."
    expect(collectCodexSources([SEARCH_ITEM], answer)).toEqual([
      { url: "https://nodejs.org/en/blog/release/v24.21.0" }
    ])
  })

  it("keeps an opened page that returned no results of its own", () => {
    expect(
      collectCodexSources(
        [
          {
            type: "webSearch",
            action: { type: "findInPage", url: "https://example.com/doc" }
          }
        ],
        ""
      )
    ).toEqual([{ url: "https://example.com/doc" }])
  })

  it("caps the list", () => {
    const opened = Array.from({ length: 20 }, (_, index) => ({
      type: "webSearch",
      action: { type: "openPage", url: `https://example.com/${index}` }
    }))
    expect(collectCodexSources(opened, "")).toHaveLength(MAX_CODEX_SOURCES)
  })

  it("returns nothing for a turn that never searched", () => {
    expect(collectCodexSources([], ANSWER)).toEqual([])
  })
})

describe("Codex failures", () => {
  const now = Date.UTC(2026, 9, 6, 12, 0, 0)
  const exhausted = {
    primary: { usedPercent: 100, resetsAt: now / 1000 + 90 },
    secondary: { usedPercent: 40, resetsAt: now / 1000 + 9000 }
  }

  it("maps a usage limit to 429 with the exhausted window's reset", () => {
    expect(
      classifyCodexError({
        message: "You've hit your usage limit",
        type: "CodexError",
        errorInfo: "usageLimitExceeded",
        rateLimits: exhausted,
        nowMs: now
      })
    ).toEqual({
      message: "You've hit your usage limit",
      type: "CodexError",
      status: 429,
      retryAfterSeconds: 90
    })
  })

  it("does not take a reset time from a window with room left", () => {
    expect(
      retryAfterFromRateLimits(
        { primary: { usedPercent: 99, resetsAt: now / 1000 + 90 } },
        now
      )
    ).toBeUndefined()
  })

  it("forwards the upstream status Codex carries on transport errors", () => {
    expect(
      classifyCodexError({
        message: "stream failed",
        type: "CodexError",
        errorInfo: { responseStreamConnectionFailed: { httpStatusCode: 503 } }
      }).status
    ).toBe(503)
  })

  it("names an oversized prompt the way OpenAI does", () => {
    expect(
      classifyCodexError({
        message: "Your input exceeds the context window",
        type: "CodexError",
        errorInfo: "contextWindowExceeded"
      })
    ).toEqual({
      message: "Your input exceeds the context window",
      type: "context_length_exceeded",
      status: 400
    })
  })

  it("leaves an unclassified failure without a status", () => {
    expect(
      classifyCodexError({
        message: "boom",
        type: "CodexError",
        errorInfo: "other"
      })
    ).toEqual({ message: "boom", type: "CodexError" })
  })
})
