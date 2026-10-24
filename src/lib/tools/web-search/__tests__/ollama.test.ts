import { afterEach, describe, expect, it, vi } from "vitest"
import { ollamaBackend } from "../backends/ollama"
import { WebSearchProviderConfigSchema } from "../config"
import { getWebSearchBackend } from "../registry"

const config = { provider: "ollama" as const, apiKey: " key ", enabled: true }

describe("Ollama web search", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("persists and resolves the Ollama backend", () => {
    expect(WebSearchProviderConfigSchema.parse(config).provider).toBe("ollama")
    expect(getWebSearchBackend("ollama")).toBe(ollamaBackend)
    expect(ollamaBackend.validateConfig({ provider: "ollama" }).ok).toBe(false)
    expect(ollamaBackend.validateConfig(config).ok).toBe(true)
  })

  it("uses the documented authenticated API and normalizes results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Ollama <b>news</b>",
              url: "https://ollama.com/blog",
              content: "<p>Fresh results</p>"
            },
            {
              title: "Other",
              url: "https://example.com",
              content: "Not selected"
            }
          ]
        })
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    const results = await ollamaBackend.search(
      { query: "what is new?", count: 1 },
      config,
      controller.signal
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ollama.com/api/web_search",
      {
        method: "POST",
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer key"
        },
        body: JSON.stringify({ query: "what is new?", max_results: 1 })
      }
    )
    expect(results).toEqual([
      expect.objectContaining({
        title: "Ollama news",
        snippet: "Fresh results",
        source: "ollama.com"
      })
    ])
  })

  it.each([401, 429, 500])(
    "reports HTTP %s without exposing response bodies or credentials",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("private account details", { status })
          )
      )
      await expect(
        ollamaBackend.search({ query: "test" }, config)
      ).rejects.toThrow(`Ollama search failed with HTTP ${status}`)
    }
  )

  it("rejects malformed results", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ results: "invalid" })))
    )
    await expect(
      ollamaBackend.search({ query: "test" }, config)
    ).rejects.toThrow("invalid response")
  })

  it("makes no request with a missing key or cancelled signal", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      ollamaBackend.search({ query: "test" }, { provider: "ollama" })
    ).rejects.toThrow("requires an API key")
    const controller = new AbortController()
    controller.abort()
    await expect(
      ollamaBackend.search({ query: "test" }, config, controller.signal)
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
