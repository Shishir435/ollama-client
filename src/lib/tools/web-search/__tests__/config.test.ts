import { beforeEach, describe, expect, it, vi } from "vitest"

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: storage.get,
  setPlasmoStoredValue: storage.set
}))

import { STORAGE_KEYS } from "@/lib/constants"
import {
  DEFAULT_SEARXNG_ENDPOINT,
  DEFAULT_WEB_SEARCH_CONFIG,
  getWebSearchConfig,
  settleLegacyWebSearchDefault,
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
        // A malformed flag falls back to the default, which is now off.
        enabled: false
      })
    )
  })

  it("preserves native execution policy and rejects invalid policy values", () => {
    expect(
      WebSearchProviderConfigSchema.parse({
        executionSource: "native",
        nativeMode: "live"
      })
    ).toEqual(
      expect.objectContaining({ executionSource: "native", nativeMode: "live" })
    )
    expect(
      WebSearchProviderConfigSchema.parse({
        executionSource: "remote",
        nativeMode: "unlimited"
      })
    ).toEqual(
      expect.objectContaining({
        executionSource: "client",
        nativeMode: "cached"
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

  it("keeps other providers' keys across a reload, without needing them", async () => {
    storage.get.mockResolvedValue({
      provider: "brave",
      apiKey: "brave-key",
      apiKeysByProvider: { tavily: "tvly-key", searxng: "" }
    })

    await expect(getWebSearchConfig()).resolves.toEqual(
      expect.objectContaining({
        apiKey: "brave-key",
        apiKeysByProvider: { tavily: "tvly-key", searxng: "" }
      })
    )
  })

  it("reads a config saved before per-provider keys existed", async () => {
    storage.get.mockResolvedValue({ provider: "tavily", apiKey: "tvly" })

    const parsed = await getWebSearchConfig()
    expect(parsed.apiKey).toBe("tvly")
    expect(parsed.apiKeysByProvider).toBeUndefined()
  })

  it("drops a malformed per-provider key map instead of failing the read", async () => {
    storage.get.mockResolvedValue({
      provider: "brave",
      apiKey: "k",
      apiKeysByProvider: "oops"
    })

    const parsed = await getWebSearchConfig()
    expect(parsed.apiKey).toBe("k")
    expect(parsed.apiKeysByProvider).toBeUndefined()
  })
})

describe("web search default", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("is off until a test passes", () => {
    expect(DEFAULT_WEB_SEARCH_CONFIG.enabled).toBe(false)
    expect(WebSearchProviderConfigSchema.parse({}).enabled).toBe(false)
  })

  it("reads a profile that never configured it as off", async () => {
    storage.get.mockResolvedValue(undefined)

    await expect(getWebSearchConfig()).resolves.toEqual(
      DEFAULT_WEB_SEARCH_CONFIG
    )
  })

  it("keeps an explicit choice either way", async () => {
    storage.get.mockResolvedValue({ provider: "brave", enabled: true })
    expect((await getWebSearchConfig()).enabled).toBe(true)

    storage.get.mockResolvedValue({ provider: "brave", enabled: false })
    expect((await getWebSearchConfig()).enabled).toBe(false)
  })
})

describe("settleLegacyWebSearchDefault", () => {
  const stored = (values: Record<string, unknown>) =>
    storage.get.mockImplementation(async (key: string) => values[key])
  const writes = () =>
    Object.fromEntries(
      storage.set.mock.calls.map(([key, value]) => [key, value])
    )

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps web search on for an updating profile that never saved settings", async () => {
    stored({})

    await expect(settleLegacyWebSearchDefault("update")).resolves.toBe(true)

    expect(writes()[STORAGE_KEYS.WEB_SEARCH.CONFIG]).toEqual(
      expect.objectContaining({ enabled: true, provider: "searxng" })
    )
    expect(writes()[STORAGE_KEYS.WEB_SEARCH.LEGACY_DEFAULT_HANDLED]).toBe(true)
  })

  it("never touches a config the user saved, on or off", async () => {
    for (const enabled of [true, false]) {
      storage.set.mockClear()
      stored({
        [STORAGE_KEYS.WEB_SEARCH.CONFIG]: { provider: "brave", enabled }
      })

      await expect(settleLegacyWebSearchDefault("update")).resolves.toBe(false)

      expect(writes()[STORAGE_KEYS.WEB_SEARCH.CONFIG]).toBeUndefined()
    }
  })

  it("keeps a config saved before it carried an enabled flag on", async () => {
    stored({
      [STORAGE_KEYS.WEB_SEARCH.CONFIG]: { provider: "brave", apiKey: "k" }
    })

    await expect(settleLegacyWebSearchDefault("update")).resolves.toBe(true)

    expect(writes()[STORAGE_KEYS.WEB_SEARCH.CONFIG]).toEqual(
      expect.objectContaining({ provider: "brave", apiKey: "k", enabled: true })
    )
  })

  it("settles an old config with a malformed field instead of throwing", async () => {
    stored({
      [STORAGE_KEYS.WEB_SEARCH.CONFIG]: {
        provider: "searxng",
        endpoint: 42,
        count: "many",
        safeSearch: "strict"
      }
    })

    await expect(settleLegacyWebSearchDefault("update")).resolves.toBe(true)

    expect(writes()[STORAGE_KEYS.WEB_SEARCH.CONFIG]).toEqual(
      expect.objectContaining({
        provider: "searxng",
        endpoint: "http://localhost:8080",
        count: 5,
        safeSearch: "strict",
        enabled: true
      })
    )
    expect(writes()[STORAGE_KEYS.WEB_SEARCH.LEGACY_DEFAULT_HANDLED]).toBe(true)
  })

  it("leaves a new install on the new default", async () => {
    stored({})

    await expect(settleLegacyWebSearchDefault("install")).resolves.toBe(false)

    expect(writes()[STORAGE_KEYS.WEB_SEARCH.CONFIG]).toBeUndefined()
    expect(writes()[STORAGE_KEYS.WEB_SEARCH.LEGACY_DEFAULT_HANDLED]).toBe(true)
  })

  it("does not mistake a later update for the first one", async () => {
    stored({ [STORAGE_KEYS.WEB_SEARCH.LEGACY_DEFAULT_HANDLED]: true })

    await expect(settleLegacyWebSearchDefault("update")).resolves.toBe(false)

    expect(storage.set).not.toHaveBeenCalled()
  })
})
