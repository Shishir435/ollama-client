import { afterEach, describe, expect, it, vi } from "vitest"
import { braveBackend } from "../backends/brave"
import { searxngBackend } from "../backends/searxng"
import { tavilyBackend } from "../backends/tavily"

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init
  })

describe("web search backends", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("normalizes SearXNG results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: "SearXNG result",
            url: "https://example.com/a",
            content: "Snippet <b>one</b>",
            publishedDate: "2026-06-14",
            engine: "duckduckgo"
          }
        ]
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const results = await searxngBackend.search(
      { query: "local search", count: 3 },
      {
        provider: "searxng",
        enabled: true,
        endpoint: "http://localhost:8080"
      }
    )

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "http://localhost:8080/search?q=local+search&format=json&pageno=1&safesearch=1"
      ),
      expect.objectContaining({ headers: { Accept: "application/json" } })
    )
    expect(results).toEqual([
      {
        title: "SearXNG result",
        url: "https://example.com/a",
        snippet: "Snippet one",
        publishedAt: "2026-06-14",
        source: "duckduckgo"
      }
    ])
  })

  it("fetches configured SearXNG pages and caps returned results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              title: "Page one",
              url: "https://example.com/one",
              content: "One"
            },
            {
              title: "Duplicate",
              url: "https://example.com/one",
              content: "Duplicate"
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              title: "Page two",
              url: "https://example.com/two",
              content: "Two"
            }
          ]
        })
      )
    vi.stubGlobal("fetch", fetchMock)

    const results = await searxngBackend.search(
      { query: "local search", count: 2 },
      {
        provider: "searxng",
        enabled: true,
        endpoint: "http://localhost:8080",
        searxngPages: 2
      }
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL(
        "http://localhost:8080/search?q=local+search&format=json&pageno=2&safesearch=1"
      ),
      expect.objectContaining({ headers: { Accept: "application/json" } })
    )
    expect(results.map((result) => result.title)).toEqual([
      "Page one",
      "Page two"
    ])
  })

  it("normalizes Brave results and sends the API key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        web: {
          results: [
            {
              title: "Brave result",
              url: "https://brave.example/result",
              description: "Brave snippet",
              profile: { name: "Example" },
              age: "2 days ago"
            }
          ]
        }
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const results = await braveBackend.search(
      { query: "api search", count: 2, safeSearch: "strict" },
      { provider: "brave", enabled: true, apiKey: "brave-key" }
    )

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining(
          "https://api.search.brave.com/res/v1/web/search"
        )
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "brave-key"
        })
      })
    )
    expect(results[0]).toMatchObject({
      title: "Brave result",
      url: "https://brave.example/result",
      snippet: "Brave snippet",
      publishedAt: "2 days ago",
      source: "Example"
    })
  })

  it("normalizes Tavily results and sends bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: "Tavily result",
            url: "https://tavily.example/result",
            content: "Tavily snippet",
            published_date: "2026-06-13"
          }
        ]
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const results = await tavilyBackend.search(
      { query: "agent search", count: 4 },
      { provider: "tavily", enabled: true, apiKey: "tvly-key" }
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tvly-key"
        }),
        body: expect.stringContaining('"max_results":4')
      })
    )
    expect(results[0]).toMatchObject({
      title: "Tavily result",
      url: "https://tavily.example/result",
      snippet: "Tavily snippet",
      publishedAt: "2026-06-13"
    })
  })

  it("validates provider-specific config", () => {
    expect(searxngBackend.validateConfig({ provider: "searxng" })).toEqual({
      ok: false,
      errorKey: "settings.web_search.errors.endpoint_required"
    })
    expect(
      searxngBackend.validateConfig({
        provider: "searxng",
        endpoint: "http://localhost:8080"
      })
    ).toEqual({ ok: true })
    expect(braveBackend.validateConfig({ provider: "brave" })).toEqual({
      ok: false,
      errorKey: "settings.web_search.errors.api_key_required"
    })
    expect(tavilyBackend.validateConfig({ provider: "tavily" })).toEqual({
      ok: false,
      errorKey: "settings.web_search.errors.api_key_required"
    })
  })

  it("passes timeRange through to each backend's recency param", async () => {
    // SearXNG: time_range query param, verbatim.
    const searxngFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ results: [] }))
    vi.stubGlobal("fetch", searxngFetch)
    await searxngBackend.search(
      { query: "recent news", timeRange: "week" },
      { provider: "searxng", enabled: true, endpoint: "http://localhost:8080" }
    )
    expect(
      (searxngFetch.mock.calls[0][0] as URL).searchParams.get("time_range")
    ).toBe("week")
    vi.unstubAllGlobals()

    // Brave: freshness = pd/pw/pm/py.
    const braveFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ web: { results: [] } }))
    vi.stubGlobal("fetch", braveFetch)
    await braveBackend.search(
      { query: "recent news", timeRange: "day" },
      { provider: "brave", enabled: true, apiKey: "k" }
    )
    expect(
      (braveFetch.mock.calls[0][0] as URL).searchParams.get("freshness")
    ).toBe("pd")
    vi.unstubAllGlobals()

    // Tavily: time_range in the JSON body.
    const tavilyFetch = vi.fn().mockResolvedValue(jsonResponse({ results: [] }))
    vi.stubGlobal("fetch", tavilyFetch)
    await tavilyBackend.search(
      { query: "recent news", timeRange: "month" },
      { provider: "tavily", enabled: true, apiKey: "k" }
    )
    expect(tavilyFetch.mock.calls[0][1]?.body).toContain('"time_range":"month"')
  })

  it("throws typed HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 }))
    )

    await expect(
      braveBackend.search(
        { query: "fail" },
        { provider: "brave", enabled: true, apiKey: "key" }
      )
    ).rejects.toThrow("Brave search failed with HTTP 500")
  })
})
