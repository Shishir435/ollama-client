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

vi.mock("../registry", () => ({
  getWebSearchBackend: vi.fn(() => ({
    id: "searxng",
    labelKey: "settings.web_search.providers.searxng",
    validateConfig: vi.fn((config: WebSearchProviderConfig) =>
      config.endpoint ? { ok: true } : { ok: false, errorKey: "missing" }
    ),
    search: vi.fn(async (_query, _config, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError")
      }
      return [
        {
          title: "Result",
          url: "https://example.com",
          snippet: "Snippet",
          source: "example.com"
        }
      ]
    })
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
        excerpt: "Snippet"
      }
    ])
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
