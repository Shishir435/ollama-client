import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WebSearchProviderConfig } from "../types"

const configState: { current: WebSearchProviderConfig } = {
  current: {
    provider: "searxng",
    enabled: false,
    endpoint: "http://localhost:8080",
    count: 5,
    safeSearch: "moderate"
  }
}

vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config")
  return {
    ...actual,
    getWebSearchConfig: vi.fn(async () => configState.current)
  }
})

const resultsState: { current: Array<Record<string, unknown>> } = {
  current: [
    {
      title: "Result",
      url: "https://example.com",
      snippet: "Snippet",
      source: "example.com"
    }
  ]
}

const lastQuery: { current: Record<string, unknown> | null } = { current: null }

vi.mock("../registry", () => ({
  getWebSearchBackend: vi.fn(() => ({
    id: "searxng",
    labelKey: "settings.web_search.providers.searxng",
    validateConfig: vi.fn((config: WebSearchProviderConfig) =>
      config.endpoint ? { ok: true } : { ok: false, errorKey: "missing" }
    ),
    search: vi.fn(
      async (query: Record<string, unknown>, _config, signal?: AbortSignal) => {
        lastQuery.current = query
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError")
        }
        return resultsState.current
      }
    )
  }))
}))

describe("web_search tool", () => {
  beforeEach(() => {
    configState.current = {
      provider: "searxng",
      enabled: false,
      endpoint: "http://localhost:8080",
      count: 5,
      safeSearch: "moderate"
    }
    resultsState.current = [
      {
        title: "Result",
        url: "https://example.com",
        snippet: "Snippet",
        source: "example.com"
      }
    ]
  })

  it("is absent from the source when disabled", async () => {
    const { createWebSearchToolSource } = await import(
      "../web-search-tool-source"
    )
    await expect(createWebSearchToolSource().listTools()).resolves.toEqual([])
  })

  it("is listed when config is enabled and valid", async () => {
    configState.current.enabled = true
    const { createWebSearchToolSource } = await import(
      "../web-search-tool-source"
    )
    const tools = await createWebSearchToolSource().listTools()
    expect(tools.map((tool) => tool.name)).toEqual(["web_search"])
  })

  it("returns normalized content with sources", async () => {
    configState.current.enabled = true
    const { runWebSearch } = await import("../web-search-tool")
    const result = await runWebSearch({ query: "current facts" }, {})
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain("Web search results")
    expect(result.content).toContain("https://example.com")
    expect(result.sources).toEqual([
      {
        title: "Result",
        url: "https://example.com",
        excerpt: "Snippet",
        used: true
      }
    ])
  })

  it("marks results beyond the cap as unused and only sends the cap to the model", async () => {
    configState.current.enabled = true
    configState.current.count = 2
    resultsState.current = Array.from({ length: 5 }, (_, i) => ({
      title: `Result ${i + 1}`,
      url: `https://example.com/${i + 1}`,
      snippet: `Snippet ${i + 1}`,
      source: "example.com"
    }))
    const { runWebSearch } = await import("../web-search-tool")
    const result = await runWebSearch({ query: "facts" }, {})

    // All five surface in sources; only the first two are flagged used.
    expect(result.sources).toHaveLength(5)
    expect(result.sources?.filter((s) => s.used)).toHaveLength(2)
    expect(result.sources?.map((s) => s.used)).toEqual([
      true,
      true,
      false,
      false,
      false
    ])
    // The model-facing content lists only the used slice.
    expect(result.content).toContain("Result 1")
    expect(result.content).toContain("Result 2")
    expect(result.content).not.toContain("Result 3")
  })

  it("passes a valid time_range through to the backend and ignores invalid ones", async () => {
    configState.current.enabled = true
    const { runWebSearch } = await import("../web-search-tool")

    await runWebSearch({ query: "latest news", time_range: "week" }, {})
    expect(lastQuery.current?.timeRange).toBe("week")

    await runWebSearch({ query: "latest news", time_range: "decade" }, {})
    expect(lastQuery.current?.timeRange).toBeUndefined()
  })

  it("returns an error when query is missing", async () => {
    const { runWebSearch } = await import("../web-search-tool")
    const result = await runWebSearch({}, {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain("non-empty")
  })

  it("turns aborts into an error result", async () => {
    configState.current.enabled = true
    const controller = new AbortController()
    controller.abort()
    const { runWebSearch } = await import("../web-search-tool")
    const result = await runWebSearch(
      { query: "cancel" },
      { signal: controller.signal }
    )
    expect(result).toEqual({
      content: "Web search was cancelled.",
      isError: true
    })
  })

  it("defaults SearXNG endpoint to localhost", async () => {
    const { normalizeWebSearchConfig } = await import("../config")
    expect(
      normalizeWebSearchConfig({
        provider: "searxng",
        endpoint: ""
      }).endpoint
    ).toBe("http://localhost:8080")
  })

  it("clamps SearXNG pages and result count", async () => {
    const { normalizeWebSearchConfig } = await import("../config")
    expect(
      normalizeWebSearchConfig({
        provider: "searxng",
        count: 99,
        searxngPages: 99
      })
    ).toMatchObject({
      count: 10,
      searxngPages: 3
    })
  })
})
