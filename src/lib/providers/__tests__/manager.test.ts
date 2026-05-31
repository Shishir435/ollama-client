import { beforeEach, describe, expect, it, vi } from "vitest"

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: storage
}))

import { DEFAULT_PROVIDERS, ProviderManager } from "../manager"
import { ProviderId, ProviderStorageKey, ProviderType } from "../types"

describe("ProviderManager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.get.mockResolvedValue(undefined)
    storage.set.mockResolvedValue(undefined)
  })

  it("removes stale OpenAI config that is no longer in the provider UI", async () => {
    storage.get.mockImplementation(async (key: string) => {
      if (key === ProviderStorageKey.CONFIG) {
        return [
          DEFAULT_PROVIDERS[0],
          {
            id: ProviderId.OPENAI,
            type: ProviderType.OPENAI,
            name: "OpenAI",
            enabled: true,
            baseUrl: "https://api.openai.com/v1"
          },
          {
            id: ProviderId.LM_STUDIO,
            type: ProviderType.OPENAI,
            name: "LM Studio",
            enabled: true,
            baseUrl: "http://localhost:1234/v1"
          }
        ]
      }
      return undefined
    })

    const providers = await ProviderManager.getProviders()

    expect(providers.map((provider) => provider.id)).not.toContain(
      ProviderId.OPENAI
    )
    expect(providers.map((provider) => provider.id)).toContain(
      ProviderId.LM_STUDIO
    )
    expect(storage.set).toHaveBeenCalledWith(
      ProviderStorageKey.CONFIG,
      expect.not.arrayContaining([
        expect.objectContaining({ id: ProviderId.OPENAI })
      ])
    )
  })
})
