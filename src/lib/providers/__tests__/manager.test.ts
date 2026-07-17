import { beforeEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"

const stores = vi.hoisted(() => ({
  sync: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn()
  },
  local: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn()
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: stores.sync,
  plasmoDeviceStorage: stores.local,
  removePlasmoStoredValue: vi.fn(async (key: string) =>
    key.startsWith("llm_provider_")
      ? stores.local.remove(key)
      : stores.sync.remove(key)
  )
}))

import { DEFAULT_PROVIDERS, ProviderManager } from "../manager"
import { resetProviderStorageUnlocked } from "../provider-secret-store"
import {
  isCustomProviderId,
  type ProviderConfig,
  ProviderId,
  ProviderServiceProfile,
  ProviderStorageKey,
  ProviderType
} from "../types"

/** Back the mock with a real map so read-modify-write flows behave. */
const syncBacking = new Map<string, unknown>()
const localBacking = new Map<string, unknown>()

describe("ProviderManager", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    syncBacking.clear()
    localBacking.clear()
    stores.sync.get.mockImplementation(async (key: string) =>
      syncBacking.get(key)
    )
    stores.sync.set.mockImplementation(async (key: string, value: unknown) => {
      syncBacking.set(key, value)
    })
    stores.sync.remove.mockImplementation(async (key: string) => {
      syncBacking.delete(key)
    })
    stores.local.get.mockImplementation(async (key: string) =>
      localBacking.get(key)
    )
    stores.local.set.mockImplementation(async (key: string, value: unknown) => {
      localBacking.set(key, value)
    })
    stores.local.remove.mockImplementation(async (key: string) => {
      localBacking.delete(key)
    })
  })

  it("ships only the three verified built-in providers", () => {
    expect(DEFAULT_PROVIDERS.map((provider) => provider.id)).toEqual([
      ProviderId.OLLAMA,
      ProviderId.LM_STUDIO,
      ProviderId.LLAMA_CPP
    ])
  })

  it("stores provider API keys locally and keeps sync config secret-free", async () => {
    const providers = [
      ...DEFAULT_PROVIDERS,
      {
        id: "custom:openai:secure",
        type: ProviderType.OPENAI,
        name: "Remote",
        enabled: true,
        baseUrl: "https://example.com/v1",
        apiKey: "sk-local-only"
      }
    ]

    await ProviderManager.saveProviders(providers)

    expect(localBacking.get(STORAGE_KEYS.PROVIDER.SECRETS)).toEqual({
      "custom:openai:secure": "sk-local-only"
    })
    expect(syncBacking.get(ProviderStorageKey.CONFIG)).toEqual(
      providers.map(({ apiKey: _apiKey, ...provider }) => provider)
    )
    expect(
      JSON.stringify(syncBacking.get(ProviderStorageKey.CONFIG))
    ).not.toContain("sk-local-only")
    await expect(
      ProviderManager.getProviderConfig("custom:openai:secure")
    ).resolves.toMatchObject({ apiKey: "sk-local-only" })
  })

  it("migrates legacy synced API keys to local storage before purging them", async () => {
    syncBacking.set(ProviderStorageKey.CONFIG, [
      ...DEFAULT_PROVIDERS,
      {
        id: "custom:openai:legacy",
        type: ProviderType.OPENAI,
        name: "Legacy remote",
        enabled: true,
        baseUrl: "https://example.com/v1",
        apiKey: "sk-legacy"
      }
    ])

    const providers = await ProviderManager.getProviders()

    expect(
      providers.find((provider) => provider.id === "custom:openai:legacy")
    ).toMatchObject({ apiKey: "sk-legacy" })
    expect(localBacking.get(STORAGE_KEYS.PROVIDER.SECRETS)).toEqual({
      "custom:openai:legacy": "sk-legacy"
    })
    expect(
      JSON.stringify(syncBacking.get(ProviderStorageKey.CONFIG))
    ).not.toContain("sk-legacy")
    expect(stores.local.set.mock.invocationCallOrder[0]).toBeLessThan(
      stores.sync.set.mock.invocationCallOrder[0]
    )
  })

  it("does not purge a synced API key when local persistence fails", async () => {
    const legacyProviders = [
      ...DEFAULT_PROVIDERS,
      {
        id: "custom:openai:retry",
        type: ProviderType.OPENAI,
        name: "Retry remote",
        enabled: true,
        baseUrl: "https://example.com/v1",
        apiKey: "sk-retry"
      }
    ]
    syncBacking.set(ProviderStorageKey.CONFIG, legacyProviders)
    stores.local.set.mockRejectedValueOnce(new Error("local write failed"))

    await expect(ProviderManager.getProviders()).rejects.toThrow(
      "local write failed"
    )
    expect(syncBacking.get(ProviderStorageKey.CONFIG)).toEqual(legacyProviders)
  })

  it("rolls local credentials back when the sync commit fails", async () => {
    const provider = {
      id: "custom:openai:rollback",
      type: ProviderType.OPENAI,
      name: "Rollback remote",
      enabled: true,
      baseUrl: "https://example.com/v1"
    }
    syncBacking.set(ProviderStorageKey.CONFIG, [...DEFAULT_PROVIDERS, provider])
    localBacking.set(STORAGE_KEYS.PROVIDER.SECRETS, {
      [provider.id]: "sk-preserved"
    })
    stores.sync.set.mockRejectedValueOnce(new Error("sync write failed"))

    await expect(
      ProviderManager.saveProviders([...DEFAULT_PROVIDERS])
    ).rejects.toThrow("sync write failed")

    expect(localBacking.get(STORAGE_KEYS.PROVIDER.SECRETS)).toEqual({
      [provider.id]: "sk-preserved"
    })
    expect(syncBacking.get(ProviderStorageKey.CONFIG)).toContainEqual(provider)
    expect(localBacking.has(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)).toBe(
      false
    )
  })

  it("repairs an interruption after journaling but before the sync commit", async () => {
    const provider = {
      id: "custom:openai:recover-pre-commit",
      type: ProviderType.OPENAI,
      name: "Recover pre-commit",
      enabled: true,
      baseUrl: "https://example.com/v1"
    }
    syncBacking.set(ProviderStorageKey.CONFIG, [...DEFAULT_PROVIDERS, provider])
    localBacking.set(STORAGE_KEYS.PROVIDER.SECRETS, {
      [provider.id]: "sk-before-interruption"
    })
    stores.local.set
      .mockImplementationOnce(async (key: string, value: unknown) => {
        localBacking.set(key, value)
      })
      .mockRejectedValueOnce(new Error("secret write interrupted"))

    await expect(
      ProviderManager.saveProviders([...DEFAULT_PROVIDERS])
    ).rejects.toThrow("secret write interrupted")
    expect(stores.sync.set).not.toHaveBeenCalled()
    expect(localBacking.has(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)).toBe(
      true
    )

    await expect(
      ProviderManager.getProviderConfig(provider.id)
    ).resolves.toMatchObject({ apiKey: "sk-before-interruption" })
    expect(localBacking.has(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)).toBe(
      false
    )
  })

  it("repairs an interrupted rollback from the durable journal", async () => {
    const provider = {
      id: "custom:openai:recover-rollback",
      type: ProviderType.OPENAI,
      name: "Recover rollback",
      enabled: true,
      baseUrl: "https://example.com/v1"
    }
    syncBacking.set(ProviderStorageKey.CONFIG, [...DEFAULT_PROVIDERS, provider])
    localBacking.set(STORAGE_KEYS.PROVIDER.SECRETS, {
      [provider.id]: "sk-recovered"
    })
    stores.local.set
      .mockImplementationOnce(async (key: string, value: unknown) => {
        localBacking.set(key, value)
      })
      .mockImplementationOnce(async (key: string, value: unknown) => {
        localBacking.set(key, value)
      })
      .mockRejectedValueOnce(new Error("rollback write failed"))
    stores.sync.set.mockRejectedValueOnce(new Error("sync write failed"))

    await expect(
      ProviderManager.saveProviders([...DEFAULT_PROVIDERS])
    ).rejects.toThrow("credential rollback both failed")
    expect(localBacking.get(STORAGE_KEYS.PROVIDER.SECRETS)).toEqual({})
    expect(localBacking.has(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)).toBe(
      true
    )

    await expect(
      ProviderManager.getProviderConfig(provider.id)
    ).resolves.toMatchObject({ apiKey: "sk-recovered" })
    expect(localBacking.get(STORAGE_KEYS.PROVIDER.SECRETS)).toEqual({
      [provider.id]: "sk-recovered"
    })
    expect(localBacking.has(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)).toBe(
      false
    )
  })

  it("rolls a committed revision forward when journal cleanup was interrupted", async () => {
    syncBacking.set(ProviderStorageKey.CONFIG, [...DEFAULT_PROVIDERS])
    const provider = {
      id: "custom:openai:recover-commit",
      type: ProviderType.OPENAI,
      name: "Recover commit",
      enabled: true,
      baseUrl: "https://example.com/v1",
      apiKey: "sk-committed"
    }
    stores.local.remove.mockRejectedValueOnce(new Error("cleanup failed"))

    await expect(
      ProviderManager.saveProviders([...DEFAULT_PROVIDERS, provider])
    ).rejects.toThrow("cleanup failed")
    expect(localBacking.has(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)).toBe(
      true
    )

    await expect(
      ProviderManager.getProviderConfig(provider.id)
    ).resolves.toMatchObject({ apiKey: "sk-committed" })
    expect(localBacking.get(STORAGE_KEYS.PROVIDER.SECRETS)).toEqual({
      [provider.id]: "sk-committed"
    })
    expect(localBacking.has(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)).toBe(
      false
    )
  })

  it("finishes an interrupted provider reset before restoring defaults", async () => {
    const removedProvider = {
      id: "custom:openai:reset-interrupted",
      type: ProviderType.OPENAI,
      name: "Reset interrupted",
      enabled: true,
      baseUrl: "https://example.com/v1"
    }
    syncBacking.set(ProviderStorageKey.CONFIG, [
      ...DEFAULT_PROVIDERS,
      removedProvider
    ])
    localBacking.set(STORAGE_KEYS.PROVIDER.SECRETS, {
      [removedProvider.id]: "sk-must-be-cleared"
    })
    let interruptSecretRemoval = true
    stores.local.remove.mockImplementation(async (key: string) => {
      if (key === STORAGE_KEYS.PROVIDER.SECRETS && interruptSecretRemoval) {
        interruptSecretRemoval = false
        throw new Error("secret cleanup interrupted")
      }
      localBacking.delete(key)
    })

    await expect(
      resetProviderStorageUnlocked([
        ProviderStorageKey.CONFIG,
        STORAGE_KEYS.PROVIDER.SECRETS,
        STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL,
        STORAGE_KEYS.PROVIDER.RESET_JOURNAL
      ])
    ).rejects.toThrow("secret cleanup interrupted")

    expect(syncBacking.has(ProviderStorageKey.CONFIG)).toBe(false)
    expect(localBacking.get(STORAGE_KEYS.PROVIDER.SECRETS)).toEqual({
      [removedProvider.id]: "sk-must-be-cleared"
    })
    expect(localBacking.has(STORAGE_KEYS.PROVIDER.RESET_JOURNAL)).toBe(true)

    const providers = await ProviderManager.getProviders()

    expect(providers).toEqual(DEFAULT_PROVIDERS)
    expect(localBacking.get(STORAGE_KEYS.PROVIDER.SECRETS)).toEqual({})
    expect(localBacking.has(STORAGE_KEYS.PROVIDER.RESET_JOURNAL)).toBe(false)
    expect(
      JSON.stringify(syncBacking.get(ProviderStorageKey.CONFIG))
    ).not.toContain(removedProvider.id)
  })

  it("serializes overlapping provider saves across both storage areas", async () => {
    const events: string[] = []
    let releaseFirstLocalWrite: (() => void) | undefined
    const firstLocalWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstLocalWrite = resolve
    })
    const firstProviders = [
      ...DEFAULT_PROVIDERS,
      {
        id: "custom:openai:first",
        type: ProviderType.OPENAI,
        name: "First",
        enabled: true,
        baseUrl: "https://first.example/v1",
        apiKey: "sk-first"
      }
    ]
    const secondProviders = [
      ...DEFAULT_PROVIDERS,
      {
        id: "custom:openai:second",
        type: ProviderType.OPENAI,
        name: "Second",
        enabled: true,
        baseUrl: "https://second.example/v1",
        apiKey: "sk-second"
      }
    ]

    stores.local.set.mockImplementation(async (key: string, value: unknown) => {
      const revisionValue =
        key === STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL
          ? (value as { nextPublicConfigs: ProviderConfig[] }).nextPublicConfigs
          : value
      const revision = JSON.stringify(revisionValue).includes(
        "custom:openai:first"
      )
        ? "first"
        : "second"
      if (key === STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL) {
        events.push(`journal:${revision}`)
      } else {
        events.push(`local:${revision}`)
      }
      localBacking.set(key, value)
      if (events.length === 1) await firstLocalWriteBlocked
    })
    stores.sync.set.mockImplementation(async (key: string, value: unknown) => {
      const configs = value as ProviderConfig[]
      events.push(
        configs.some((provider) => provider.id === "custom:openai:first")
          ? "sync:first"
          : "sync:second"
      )
      syncBacking.set(key, value)
    })

    const firstSave = ProviderManager.saveProviders(firstProviders)
    await vi.waitFor(() => expect(events).toEqual(["journal:first"]))
    const secondSave = ProviderManager.saveProviders(secondProviders)

    await Promise.resolve()
    expect(events).toEqual(["journal:first"])
    releaseFirstLocalWrite?.()
    await Promise.all([firstSave, secondSave])

    expect(events).toEqual([
      "journal:first",
      "local:first",
      "sync:first",
      "journal:second",
      "local:second",
      "sync:second"
    ])
    expect(localBacking.get(STORAGE_KEYS.PROVIDER.SECRETS)).toEqual({
      "custom:openai:second": "sk-second"
    })
    expect(
      (syncBacking.get(ProviderStorageKey.CONFIG) as ProviderConfig[]).some(
        (provider) => provider.id === "custom:openai:second"
      )
    ).toBe(true)
  })

  it("locks concurrent provider read-modify-write operations", async () => {
    syncBacking.set(ProviderStorageKey.CONFIG, [...DEFAULT_PROVIDERS])
    let releaseFirstWrite: (() => void) | undefined
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    stores.local.set.mockImplementationOnce(
      async (key: string, value: unknown) => {
        localBacking.set(key, value)
        await firstWriteBlocked
      }
    )

    const enableLmStudio = ProviderManager.updateProviderConfig(
      ProviderId.LM_STUDIO,
      { enabled: true }
    )
    await vi.waitFor(() => expect(stores.local.set).toHaveBeenCalledTimes(1))

    const enableLlamaCpp = ProviderManager.updateProviderConfig(
      ProviderId.LLAMA_CPP,
      { enabled: true }
    )
    await Promise.resolve()

    // Second transaction cannot read its snapshot while first write is open.
    expect(stores.sync.get).toHaveBeenCalledTimes(3)
    releaseFirstWrite?.()
    await Promise.all([enableLmStudio, enableLlamaCpp])

    const stored = syncBacking.get(
      ProviderStorageKey.CONFIG
    ) as ProviderConfig[]
    expect(
      stored.find((provider) => provider.id === ProviderId.LM_STUDIO)?.enabled
    ).toBe(true)
    expect(
      stored.find((provider) => provider.id === ProviderId.LLAMA_CPP)?.enabled
    ).toBe(true)
  })

  it("removes a cleared API key from local storage", async () => {
    syncBacking.set(ProviderStorageKey.CONFIG, [...DEFAULT_PROVIDERS])
    localBacking.set(STORAGE_KEYS.PROVIDER.SECRETS, {
      [ProviderId.LM_STUDIO]: "old-key"
    })

    await ProviderManager.updateProviderConfig(ProviderId.LM_STUDIO, {
      apiKey: ""
    })

    expect(localBacking.get(STORAGE_KEYS.PROVIDER.SECRETS)).toEqual({})
    expect(
      JSON.stringify(syncBacking.get(ProviderStorageKey.CONFIG))
    ).not.toContain("old-key")
  })

  it("removes stale OpenAI config that is no longer in the provider UI", async () => {
    stores.sync.get.mockImplementation(async (key: string) => {
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
    expect(stores.sync.set).toHaveBeenCalledWith(
      ProviderStorageKey.CONFIG,
      expect.not.arrayContaining([
        expect.objectContaining({ id: ProviderId.OPENAI })
      ])
    )
  })

  it("keeps custom providers through the sanitizer", async () => {
    syncBacking.set(ProviderStorageKey.CONFIG, [
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
    syncBacking.set("provider-base-url", "http://old-device:11434")

    const providers = await ProviderManager.getProviders()

    expect(
      providers.find((provider) => provider.id === ProviderId.OLLAMA)?.baseUrl
    ).toBe("http://old-device:11434")
    expect(syncBacking.has("provider-base-url")).toBe(false)
  })

  it("keeps an explicit canonical URL over stale legacy/global values", async () => {
    syncBacking.set(ProviderStorageKey.CONFIG, [
      {
        ...DEFAULT_PROVIDERS[0],
        baseUrl: "http://canonical:11434"
      },
      ...DEFAULT_PROVIDERS.slice(1)
    ])
    syncBacking.set("ollama-base-url", "http://legacy:11434")
    syncBacking.set("provider-base-url", "http://global:11434")

    const providers = await ProviderManager.getProviders()

    expect(
      providers.find((provider) => provider.id === ProviderId.OLLAMA)?.baseUrl
    ).toBe("http://canonical:11434")
    expect(syncBacking.has("ollama-base-url")).toBe(false)
    expect(syncBacking.has("provider-base-url")).toBe(false)
  })

  it("updates only canonical provider config for Ollama URL changes", async () => {
    syncBacking.set(ProviderStorageKey.CONFIG, [...DEFAULT_PROVIDERS])

    await ProviderManager.updateProviderConfig(ProviderId.OLLAMA, {
      baseUrl: "http://new-host:11434"
    })

    const providers = syncBacking.get(
      ProviderStorageKey.CONFIG
    ) as typeof DEFAULT_PROVIDERS
    expect(
      providers.find((provider) => provider.id === ProviderId.OLLAMA)?.baseUrl
    ).toBe("http://new-host:11434")
    expect(syncBacking.has("ollama-base-url")).toBe(false)
    expect(syncBacking.has("provider-base-url")).toBe(false)
  })

  it("drops untouched beta defaults but preserves configured ones as custom", async () => {
    syncBacking.set(ProviderStorageKey.CONFIG, [
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
        serviceProfile: ProviderServiceProfile.ANTHROPIC,
        apiKey: "sk-ant-test",
        customModels: ["claude-sonnet", "claude-sonnet", " "]
      })

      expect(config.id).toMatch(/^custom:anthropic:/)
      expect(config.type).toBe(ProviderType.ANTHROPIC)
      expect(config.customModels).toEqual(["claude-sonnet"])
    })

    it("requires an API key for branded Anthropic", async () => {
      await expect(
        ProviderManager.addCustomProvider({
          name: "Claude",
          baseUrl: "https://api.anthropic.com/v1",
          wire: "anthropic",
          serviceProfile: ProviderServiceProfile.ANTHROPIC
        })
      ).rejects.toThrow(/API key/i)
    })

    it("allows keyless generic Anthropic-compatible endpoints", async () => {
      const config = await ProviderManager.addCustomProvider({
        name: "Local Messages server",
        baseUrl: "http://localhost:8080/v1",
        wire: "anthropic"
      })

      expect(config.type).toBe(ProviderType.ANTHROPIC)
      expect(config.apiKey).toBeUndefined()
      expect(config.serviceProfile).toBeUndefined()
    })

    it("persists the OpenRouter service profile on the OpenAI wire", async () => {
      const config = await ProviderManager.addCustomProvider({
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        wire: "openai",
        apiKey: "sk-or-test",
        serviceProfile: ProviderServiceProfile.OPENROUTER
      })

      expect(config.type).toBe(ProviderType.OPENAI)
      expect(config.serviceProfile).toBe(ProviderServiceProfile.OPENROUTER)
    })

    it("rejects clearing credentials from an existing hosted profile", async () => {
      const config = await ProviderManager.addCustomProvider({
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        wire: "openai",
        apiKey: "sk-or-test",
        serviceProfile: ProviderServiceProfile.OPENROUTER
      })

      await expect(
        ProviderManager.updateProviderConfig(String(config.id), { apiKey: "" })
      ).rejects.toThrow(/API key/i)
      await expect(
        ProviderManager.getProviderConfig(String(config.id))
      ).resolves.toMatchObject({ apiKey: "sk-or-test" })
    })

    it("rejects hosted profile and wire mismatches during edits", async () => {
      const config = await ProviderManager.addCustomProvider({
        name: "Local Messages",
        baseUrl: "http://localhost:8080/v1",
        wire: "anthropic"
      })

      await expect(
        ProviderManager.updateProviderConfig(String(config.id), {
          type: ProviderType.OPENAI,
          serviceProfile: ProviderServiceProfile.ANTHROPIC,
          apiKey: "sk-ant-test"
        })
      ).rejects.toThrow(/Messages wire/i)
    })

    it("requires credentials when the OpenAI endpoint implies its profile", async () => {
      await expect(
        ProviderManager.addCustomProvider({
          name: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          wire: "openai"
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
      syncBacking.set(ProviderStorageKey.CONFIG, [
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
      syncBacking.set(ProviderStorageKey.MODEL_MAPPINGS, {
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
      expect(syncBacking.has(ProviderStorageKey.MODEL_MAPPINGS)).toBe(false)
      expect(
        syncBacking.get(ProviderStorageKey.MODEL_MAPPINGS_V2)
      ).toMatchObject({
        [`${ProviderId.LM_STUDIO}::llama3`]: ProviderId.LM_STUDIO
      })
    })

    it("remaps scoped beta-provider mappings to migrated custom ids", async () => {
      syncBacking.set(ProviderStorageKey.MODEL_MAPPINGS_V2, {
        [`${ProviderId.VLLM}::qwen3`]: ProviderId.VLLM
      })

      expect(await ProviderManager.getModelMapping("qwen3")).toEqual({
        providerId: "custom:openai:legacy-vllm"
      })
      expect(syncBacking.get(ProviderStorageKey.MODEL_MAPPINGS_V2)).toEqual({
        "custom:openai:legacy-vllm::qwen3": "custom:openai:legacy-vllm"
      })
    })

    it("returns null for unmapped models", async () => {
      expect(await ProviderManager.getModelMapping("nope")).toBeNull()
    })
  })
})
