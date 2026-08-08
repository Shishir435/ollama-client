import { describe, expect, it } from "vitest"
import {
  DEFAULT_SEARXNG_ENDPOINT,
  WebSearchProviderConfigSchema
} from "../config"

describe("WebSearchProviderConfigSchema", () => {
  it("normalizes partial legacy values", () => {
    expect(
      WebSearchProviderConfigSchema.parse({
        provider: "searxng",
        endpoint: "",
        count: 99,
        searxngPages: 0
      })
    ).toEqual(
      expect.objectContaining({
        provider: "searxng",
        endpoint: DEFAULT_SEARXNG_ENDPOINT,
        count: 10,
        searxngPages: 1
      })
    )
  })

  it("drops malformed fields while preserving valid secrets", () => {
    expect(
      WebSearchProviderConfigSchema.parse({
        provider: "unknown",
        apiKey: "secret",
        count: "many",
        enabled: "yes"
      })
    ).toEqual(
      expect.objectContaining({
        provider: "searxng",
        apiKey: "secret",
        count: 5,
        enabled: true
      })
    )
  })

  it("rejects non-object persisted values", () => {
    expect(WebSearchProviderConfigSchema.safeParse("broken").success).toBe(
      false
    )
  })
})
