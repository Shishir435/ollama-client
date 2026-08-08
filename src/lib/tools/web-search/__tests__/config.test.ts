import { beforeEach, describe, expect, it, vi } from "vitest"

const storage = vi.hoisted(() => ({
  get: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: storage.get,
  setPlasmoStoredValue: vi.fn()
}))

import {
  DEFAULT_SEARXNG_ENDPOINT,
  DEFAULT_WEB_SEARCH_CONFIG,
  getWebSearchConfig,
  WebSearchProviderConfigSchema
} from "../config"

describe("WebSearchProviderConfigSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it("applies the same parser on the runtime read path", async () => {
    storage.get.mockResolvedValue({
      provider: "unknown",
      apiKey: "secret",
      count: "many",
      safeSearch: "unsafe",
      enabled: true
    })

    await expect(getWebSearchConfig()).resolves.toEqual(
      expect.objectContaining({
        provider: "searxng",
        apiKey: "secret",
        count: 5,
        safeSearch: "moderate",
        enabled: true
      })
    )
  })

  it("falls back safely when runtime storage is not an object", async () => {
    storage.get.mockResolvedValue("broken")

    await expect(getWebSearchConfig()).resolves.toEqual(
      DEFAULT_WEB_SEARCH_CONFIG
    )
  })
})
