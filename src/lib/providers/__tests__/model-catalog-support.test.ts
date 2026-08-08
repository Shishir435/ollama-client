import { beforeEach, describe, expect, it, vi } from "vitest"

const storageBacking = vi.hoisted(() => new Map<string, unknown>())

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => storageBacking.get(key)),
  setPlasmoStoredValue: vi.fn(async (key: string, value: unknown) => {
    storageBacking.set(key, value)
  })
}))

import {
  CATALOG_SUPPORT_TTL_MS,
  clearModelCatalogSupport,
  getModelCatalogSupport,
  isCatalogAbsentStatus,
  recordModelCatalogSupport,
  shouldSkipModelCatalog
} from "../model-catalog-support"
import {
  type ProviderConfig,
  ProviderServiceProfile,
  ProviderType
} from "../types"

const config: ProviderConfig = {
  id: "custom:openai:router",
  type: ProviderType.OPENAI,
  name: "Router",
  enabled: true,
  baseUrl: "https://api.example.test/v1"
}

beforeEach(() => {
  storageBacking.clear()
})

describe("model catalog support", () => {
  it("remembers that an endpoint publishes no catalog", async () => {
    await recordModelCatalogSupport(config, false)

    expect(await getModelCatalogSupport(config)).toBe(false)
    expect(await shouldSkipModelCatalog(config)).toBe(true)
  })

  it("keeps asking an endpoint that does publish one", async () => {
    await recordModelCatalogSupport(config, true)

    expect(await shouldSkipModelCatalog(config)).toBe(false)
  })

  it("stops applying once the config points somewhere else", async () => {
    await recordModelCatalogSupport(config, false)

    // A new base URL is a new server; what the old one answered says nothing
    // about this one.
    expect(
      await getModelCatalogSupport({
        ...config,
        baseUrl: "https://other.example.test/v1"
      })
    ).toBeNull()
    expect(
      await getModelCatalogSupport({
        ...config,
        serviceProfile: ProviderServiceProfile.OPENROUTER
      })
    ).toBeNull()
  })

  it("ignores the API key, which cannot add or remove an endpoint", async () => {
    await recordModelCatalogSupport(config, false)

    expect(
      await getModelCatalogSupport({ ...config, apiKey: "sk-rotated" })
    ).toBe(false)
  })

  it("re-checks a negative answer once it has aged out", async () => {
    const recordedAt = 1_000_000
    await recordModelCatalogSupport(config, false, recordedAt)

    expect(
      await getModelCatalogSupport(config, recordedAt + CATALOG_SUPPORT_TTL_MS)
    ).toBe(false)
    // A server can gain the endpoint in an upgrade, so the answer expires
    // rather than writing the provider off forever.
    expect(
      await getModelCatalogSupport(
        config,
        recordedAt + CATALOG_SUPPORT_TTL_MS + 1
      )
    ).toBeNull()
  })

  it("forgets a provider that was removed", async () => {
    await recordModelCatalogSupport(config, false)
    await clearModelCatalogSupport(String(config.id))

    expect(await getModelCatalogSupport(config)).toBeNull()
  })

  it("treats only a missing endpoint as an absent catalog", () => {
    expect([404, 405, 501].map(isCatalogAbsentStatus)).toEqual([
      true,
      true,
      true
    ])
    expect(
      [200, 400, 401, 403, 429, 500, undefined].map(isCatalogAbsentStatus)
    ).toEqual([false, false, false, false, false, false, false])
  })
})
