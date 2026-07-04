import { beforeEach, describe, expect, it, vi } from "vitest"

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: storage
}))

import { DEFAULT_PROVIDERS, ProviderManager } from "../manager"
import {
  isCustomProviderId,
  ProviderId,
  ProviderStorageKey,
  ProviderType
} from "../types"

/** Back the mock with a real map so read-modify-write flows behave. */
const backing = new Map<string, unknown>()

describe("ProviderManager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backing.clear()
    storage.get.mockImplementation(async (key: string) => backing.get(key))
    storage.set.mockImplementation(async (key: string, value: unknown) => {
      backing.set(key, value)
    })
    storage.remove.mockImplementation(async (key: string) => {
      backing.delete(key)
    })
  })

  it("ships only the three verified built-in providers", () => {
    expect(DEFAULT_PROVIDERS.map((provider) => provider.id)).toEqual([
      ProviderId.OLLAMA,
      ProviderId.LM_STUDIO,
      ProviderId.LLAMA_CPP
    ])
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

  it("keeps custom providers through the sanitizer", async () => {
    backing.set(ProviderStorageKey.CONFIG, [
      ...DEFAULT_PROVIDERS,
      {
        id: "custom:openai:abc123",
        type: ProviderType.OPENAI,
        name: "My box",
        enabled: true,
        baseUrl: "http://192.168.1.10:8080/v1"
      }
    ])

    const providers = await ProviderManager.getProviders()
    expect(providers.map((p) => p.id)).toContain("custom:openai:abc123")
  })

  it("migrates the old global Ollama URL into canonical provider config on first read", async () => {
    backing.set("provider-base-url", "http://old-device:11434")

    const providers = await ProviderManager.getProviders()

    expect(
      providers.find((provider) => provider.id === ProviderId.OLLAMA)?.baseUrl
    ).toBe("http://old-device:11434")
    expect(backing.has("provider-base-url")).toBe(false)
  })

  it("keeps an explicit canonical URL over stale legacy/global values", async () => {
    backing.set(ProviderStorageKey.CONFIG, [
      {
        ...DEFAULT_PROVIDERS[0],
        baseUrl: "http://canonical:11434"
      },
      ...DEFAULT_PROVIDERS.slice(1)
    ])
    backing.set("ollama-base-url", "http://legacy:11434")
    backing.set("provider-base-url", "http://global:11434")

    const providers = await ProviderManager.getProviders()

    expect(
      providers.find((provider) => provider.id === ProviderId.OLLAMA)?.baseUrl
    ).toBe("http://canonical:11434")
    expect(backing.has("ollama-base-url")).toBe(false)
    expect(backing.has("provider-base-url")).toBe(false)
  })

  it("updates only canonical provider config for Ollama URL changes", async () => {
    backing.set(ProviderStorageKey.CONFIG, [...DEFAULT_PROVIDERS])

    await ProviderManager.updateProviderConfig(ProviderId.OLLAMA, {
      baseUrl: "http://new-host:11434"
    })

    const providers = backing.get(
      ProviderStorageKey.CONFIG
    ) as typeof DEFAULT_PROVIDERS
    expect(
      providers.find((provider) => provider.id === ProviderId.OLLAMA)?.baseUrl
    ).toBe("http://new-host:11434")
    expect(backing.has("ollama-base-url")).toBe(false)
    expect(backing.has("provider-base-url")).toBe(false)
  })

  it("drops untouched beta defaults but preserves configured ones as custom", async () => {
    backing.set(ProviderStorageKey.CONFIG, [
      ...DEFAULT_PROVIDERS,
      {
        id: ProviderId.VLLM,
        type: ProviderType.OPENAI,
        name: "vLLM",
        enabled: false,
        baseUrl: "http://localhost:8001/v1"
      },
      {
        id: ProviderId.LOCALAI,
        type: ProviderType.OPENAI,
        name: "LocalAI",
        enabled: true,
        baseUrl: "http://lan-box:8080/v1"
      }
    ])

    const providers = await ProviderManager.getProviders()

    expect(providers.map((provider) => provider.id)).not.toContain(
      ProviderId.VLLM
    )
    expect(providers).toContainEqual(
      expect.objectContaining({
        id: "custom:openai:legacy-localai",
        name: "LocalAI",
        baseUrl: "http://lan-box:8080/v1"
      })
    )
  })

  describe("custom provider CRUD", () => {
    it("adds an openai-wire custom provider", async () => {
      const config = await ProviderManager.addCustomProvider({
        name: "Home server",
        baseUrl: "http://192.168.1.10:8080/v1",
        wire: "openai",
        apiKey: "sk-test"
      })

      expect(isCustomProviderId(String(config.id))).toBe(true)
      expect(config.id).toMatch(/^custom:openai:/)
      expect(config.type).toBe(ProviderType.OPENAI)
      expect(config.enabled).toBe(true)

      const providers = await ProviderManager.getProviders()
      expect(providers.map((p) => p.id)).toContain(config.id)
    })

    it("adds an ollama-wire custom provider with ollama type", async () => {
      const config = await ProviderManager.addCustomProvider({
        name: "Second Ollama",
        baseUrl: "http://192.168.1.20:11434",
        wire: "ollama"
      })
      expect(config.id).toMatch(/^custom:ollama:/)
      expect(config.type).toBe(ProviderType.OLLAMA)
      expect(config.apiKey).toBeUndefined()
    })

    it("adds a native Anthropic provider with manual models", async () => {
      const config = await ProviderManager.addCustomProvider({
        name: "Claude",
        baseUrl: "https://api.anthropic.com/v1",
        wire: "anthropic",
        apiKey: "sk-ant-test",
        customModels: ["claude-sonnet", "claude-sonnet", " "]
      })

      expect(config.id).toMatch(/^custom:anthropic:/)
      expect(config.type).toBe(ProviderType.ANTHROPIC)
      expect(config.customModels).toEqual(["claude-sonnet"])
    })

    it("requires an API key for Anthropic", async () => {
      await expect(
        ProviderManager.addCustomProvider({
          name: "Claude",
          baseUrl: "https://api.anthropic.com/v1",
          wire: "anthropic"
        })
      ).rejects.toThrow(/API key/i)
    })

    it("rejects empty names and invalid URLs", async () => {
      await expect(
        ProviderManager.addCustomProvider({
          name: "   ",
          baseUrl: "http://x:1",
          wire: "openai"
        })
      ).rejects.toThrow(/name/i)
      await expect(
        ProviderManager.addCustomProvider({
          name: "x",
          baseUrl: "not-a-url",
          wire: "openai"
        })
      ).rejects.toThrow(/URL/i)
      await expect(
        ProviderManager.addCustomProvider({
          name: "x",
          baseUrl: "ftp://host",
          wire: "openai"
        })
      ).rejects.toThrow(/HTTP/i)
    })

    it("removes a custom provider and its model mappings", async () => {
      const config = await ProviderManager.addCustomProvider({
        name: "Temp",
        baseUrl: "http://localhost:9999/v1",
        wire: "openai"
      })
      const id = String(config.id)
      await ProviderManager.setModelMapping("llama3", id)
      await ProviderManager.setModelMapping("mistral", id)

      await ProviderManager.removeCustomProvider(id)

      const providers = await ProviderManager.getProviders()
      expect(providers.map((p) => p.id)).not.toContain(id)
      expect(await ProviderManager.getModelMapping("llama3")).toBeNull()
      expect(await ProviderManager.getModelMapping("mistral")).toBeNull()
    })

    it("refuses to remove built-in providers", async () => {
      await expect(
        ProviderManager.removeCustomProvider(ProviderId.OLLAMA)
      ).rejects.toThrow(/built-in/i)
    })
  })

  describe("scoped model mappings", () => {
    it("round-trips a mapping", async () => {
      await ProviderManager.setModelMapping("llama3", ProviderId.LM_STUDIO)
      expect(await ProviderManager.getModelMapping("llama3")).toEqual({
        providerId: ProviderId.LM_STUDIO
      })
    })

    it("keeps colliding mappings from two providers", async () => {
      const customId = "custom:openai:vllm"
      await ProviderManager.setModelMapping("llama3", ProviderId.LM_STUDIO)
      await ProviderManager.setModelMapping("llama3", customId)

      const providers = await ProviderManager.getModelProviders("llama3")
      expect(providers.sort()).toEqual([ProviderId.LM_STUDIO, customId].sort())
    })

    it("resolves bare-name collisions preferring enabled providers", async () => {
      const customId = "custom:openai:vllm"
      backing.set(ProviderStorageKey.CONFIG, [
        ...DEFAULT_PROVIDERS,
        {
          id: customId,
          type: ProviderType.OPENAI,
          name: "vLLM",
          enabled: true,
          baseUrl: "http://localhost:8001/v1"
        }
      ])
      await ProviderManager.setModelMapping("llama3", ProviderId.LM_STUDIO)
      await ProviderManager.setModelMapping("llama3", customId)

      expect(await ProviderManager.getModelMapping("llama3")).toEqual({
        providerId: customId
      })
    })

    it("migrates the legacy flat map to scoped keys once", async () => {
      backing.set(ProviderStorageKey.MODEL_MAPPINGS, {
        llama3: ProviderId.LM_STUDIO,
        qwen3: "custom:openai:vllm"
      })

      expect(await ProviderManager.getModelMapping("llama3")).toEqual({
        providerId: ProviderId.LM_STUDIO
      })
      expect(await ProviderManager.getModelMapping("qwen3")).toEqual({
        providerId: "custom:openai:vllm"
      })
      // Legacy key deleted; scoped map holds provider-prefixed keys.
      expect(backing.has(ProviderStorageKey.MODEL_MAPPINGS)).toBe(false)
      expect(backing.get(ProviderStorageKey.MODEL_MAPPINGS_V2)).toMatchObject({
        [`${ProviderId.LM_STUDIO}::llama3`]: ProviderId.LM_STUDIO
      })
    })

    it("remaps scoped beta-provider mappings to migrated custom ids", async () => {
      backing.set(ProviderStorageKey.MODEL_MAPPINGS_V2, {
        [`${ProviderId.VLLM}::qwen3`]: ProviderId.VLLM
      })

      expect(await ProviderManager.getModelMapping("qwen3")).toEqual({
        providerId: "custom:openai:legacy-vllm"
      })
      expect(backing.get(ProviderStorageKey.MODEL_MAPPINGS_V2)).toEqual({
        "custom:openai:legacy-vllm::qwen3": "custom:openai:legacy-vllm"
      })
    })

    it("returns null for unmapped models", async () => {
      expect(await ProviderManager.getModelMapping("nope")).toBeNull()
    })
  })
})
