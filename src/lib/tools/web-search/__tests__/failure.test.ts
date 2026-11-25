import { describe, expect, it } from "vitest"
import { webSearchHttpError, toWebSearchError } from "../failure"
import { WebSearchError } from "../types"

const searxng = {
  provider: "searxng" as const,
  endpoint: "http://localhost:8080"
}

describe("toWebSearchError", () => {
  it("points a stopped local SearXNG at the one-command setup", () => {
    const error = toWebSearchError(new TypeError("Failed to fetch"), searxng)

    expect(error?.messageKey).toBe(
      "settings.web_search.failures.searxng_unreachable"
    )
  })

  it("says only that a remote or keyed backend is unreachable", () => {
    expect(
      toWebSearchError(new TypeError("Failed to fetch"), {
        provider: "searxng",
        endpoint: "https://search.example.com"
      })?.messageKey
    ).toBe("settings.web_search.failures.unreachable")
    expect(
      toWebSearchError(new TypeError("NetworkError when attempting to fetch"), {
        provider: "brave"
      })?.messageKey
    ).toBe("settings.web_search.failures.unreachable")
  })

  it("names a deadline as a timeout", () => {
    const timeout = Object.assign(new Error("deadline"), {
      name: "TimeoutError"
    })

    expect(toWebSearchError(timeout, searxng)?.messageKey).toBe(
      "settings.web_search.failures.timeout"
    )
  })

  it("passes a backend's own classified error through unchanged", () => {
    const own = new WebSearchError("own", "settings.web_search.errors.x")

    expect(toWebSearchError(own, searxng)).toBe(own)
  })

  it("leaves what it cannot classify to the generic copy", () => {
    expect(toWebSearchError(new Error("kaboom"), searxng)).toBeUndefined()
  })
})

describe("webSearchHttpError", () => {
  it.each([
    ["Brave", 401, "settings.web_search.failures.auth"],
    ["Tavily", 403, "settings.web_search.failures.forbidden"],
    ["Brave", 404, "settings.web_search.failures.not_found"],
    ["Brave", 429, "settings.web_search.failures.rate_limited"],
    ["Tavily", 504, "settings.web_search.failures.timeout"],
    ["Tavily", 503, "settings.web_search.failures.http"]
  ])("reads %s HTTP %i as %s", (provider, status, key) => {
    const error = webSearchHttpError(provider, status)

    expect(error.messageKey).toBe(key)
    expect(error.message).toBe(`${provider} search failed with HTTP ${status}`)
    expect(error.messageParams).toEqual({ status })
  })

  it("reads SearXNG's 403 as the search.formats refusal, not a bad key", () => {
    expect(webSearchHttpError("SearXNG", 403).messageKey).toBe(
      "settings.web_search.errors.searxng_json_disabled"
    )
  })
})

describe("backend response decoding", () => {
  it("tells SearXNG's HTML or non-JSON answer to enable json in search.formats", async () => {
    const { decodeSearchJson } = await import("../backends/shared")
    const { z } = await import("zod")
    const html = new Response("<html></html>", {
      headers: { "Content-Type": "text/html" }
    })

    await expect(
      decodeSearchJson(html, z.object({}), "SearXNG")
    ).rejects.toMatchObject({
      messageKey: "settings.web_search.errors.searxng_json_disabled"
    })
  })

  it("gives other backends the generic non-JSON copy", async () => {
    const { decodeSearchJson } = await import("../backends/shared")
    const { z } = await import("zod")

    await expect(
      decodeSearchJson(new Response("nope"), z.object({}), "Brave")
    ).rejects.toMatchObject({
      messageKey: "settings.web_search.failures.not_json"
    })
  })

  it("keeps an abort while reading the body as an abort, not a format error", async () => {
    const { decodeSearchJson } = await import("../backends/shared")
    const { WebSearchError } = await import("../types")
    const { z } = await import("zod")
    const aborted = new DOMException("The operation was aborted.", "AbortError")
    const response = {
      json: () => Promise.reject(aborted)
    } as unknown as Response

    const failure = await decodeSearchJson(
      response,
      z.object({}),
      "SearXNG"
    ).catch((error: unknown) => error)

    expect(failure).toBe(aborted)
    expect(failure).not.toBeInstanceOf(WebSearchError)
  })
})
