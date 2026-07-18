import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getProviders: vi.fn(),
  getProviderConfig: vi.fn(),
  updateProviderConfig: vi.fn(),
  addCustomProvider: vi.fn(),
  removeCustomProvider: vi.fn(),
  getProvider: vi.fn(),
  getProviderWithConfig: vi.fn(),
  probeToolCalling: vi.fn(),
  probeReasoning: vi.fn(),
  probeVision: vi.fn(),
  setCapabilityProbe: vi.fn()
}))

vi.mock("../manager", () => ({
  ProviderManager: {
    getProviders: mocks.getProviders,
    getProviderConfig: mocks.getProviderConfig,
    updateProviderConfig: mocks.updateProviderConfig,
    addCustomProvider: mocks.addCustomProvider,
    removeCustomProvider: mocks.removeCustomProvider
  }
}))

vi.mock("../capability-probe", () => ({
  probeToolCalling: mocks.probeToolCalling,
  probeReasoning: mocks.probeReasoning,
  probeVision: mocks.probeVision,
  setCapabilityProbe: mocks.setCapabilityProbe
}))

vi.mock("../factory", () => ({
  ProviderFactory: {
    getProvider: mocks.getProvider,
    getProviderWithConfig: mocks.getProviderWithConfig
  }
}))

import { ProviderRpcService } from "../provider-rpc-service"
import { type ProviderConfig, ProviderType } from "../types"

const configs: ProviderConfig[] = [
  {
    id: "ollama",
    type: ProviderType.OLLAMA,
    enabled: true,
    baseUrl: "http://localhost:11434",
    apiKey: "private-key",
    name: "Ollama",
    customModels: ["manual-model"]
  },
  {
    id: "custom:openai:remote",
    type: ProviderType.OPENAI,
    enabled: true,
    baseUrl: "https://example.test/v1",
    name: "Remote"
  }
]

const model = (name: string) => ({
  name,
  model: name,
  modified_at: "2026-07-18T00:00:00.000Z",
  size: 1,
  digest: `digest-${name}`,
  details: {
    parent_model: "",
    format: "gguf",
    family: "llama",
    families: ["llama"],
    parameter_size: "7B",
    quantization_level: "Q4"
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getProviders.mockResolvedValue(configs)
  mocks.getProviderConfig.mockImplementation(async (id: string) =>
    configs.find((config) => config.id === id)
  )
  mocks.addCustomProvider.mockImplementation(async (input) => ({
    id: "custom:openai:new",
    type: ProviderType.OPENAI,
    enabled: true,
    ...input
  }))
  mocks.getProvider.mockImplementation(async (id: string) => ({
    id,
    getModels: async () => [model(`${id}-model`)]
  }))
  mocks.getProviderWithConfig.mockImplementation(async (config) => ({
    id: config.id,
    getModels: async () => [model("draft-model")]
  }))
  mocks.probeToolCalling.mockResolvedValue({
    toolCalling: true,
    probedAt: 1
  })
  mocks.probeReasoning.mockResolvedValue({ reasoning: false, probedAt: 2 })
  mocks.probeVision.mockResolvedValue({ vision: true, probedAt: 3 })
})

describe("ProviderRpcService", () => {
  it("lists public provider config without returning credentials", async () => {
    const result = await ProviderRpcService.list()

    expect(result.providers[0]).toMatchObject({
      id: "ollama",
      hasApiKey: true
    })
    expect(result.providers[0]).not.toHaveProperty("apiKey")
    expect(JSON.stringify(result)).not.toContain("private-key")
  })

  it("tests an unsaved draft without returning its credential", async () => {
    const result = await ProviderRpcService.testConnection({
      target: "draft",
      config: configs[0]
    })

    expect(mocks.getProviderWithConfig).toHaveBeenCalledWith(configs[0])
    expect(result).toMatchObject({
      providerId: "ollama",
      reachable: true,
      modelCount: 1
    })
    expect(result).not.toHaveProperty("apiKey")
  })

  it("keeps a stored credential background-only when testing an edited draft", async () => {
    await ProviderRpcService.testConnection({
      target: "draft",
      config: {
        ...configs[0],
        apiKey: undefined,
        baseUrl: "https://edited.example.test/v1"
      }
    })

    expect(mocks.getProviderWithConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://edited.example.test/v1",
        apiKey: "private-key"
      })
    )
  })

  it("does not restore a stored credential after the user explicitly clears it", async () => {
    await ProviderRpcService.testConnection({
      target: "draft",
      config: { ...configs[0], apiKey: "" }
    })

    expect(mocks.getProviderWithConfig).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "" })
    )
  })

  it("merges custom models and reports partial failures without query side effects", async () => {
    mocks.getProvider.mockImplementation(async (id: string) => {
      if (id === "custom:openai:remote") throw new Error("offline")
      return { id, getModels: async () => [model("discovered")] }
    })

    const result = await ProviderRpcService.listModels({ enabledOnly: true })

    expect(result.models.map(({ name }) => name)).toEqual([
      "discovered",
      "manual-model"
    ])
    expect(result.failures).toEqual([
      { providerId: "custom:openai:remote", code: "request_failed" }
    ])
  })

  it("fails when every selected provider is unavailable", async () => {
    mocks.getProvider.mockRejectedValue(new Error("offline"))

    await expect(
      ProviderRpcService.listModels({ enabledOnly: true })
    ).rejects.toMatchObject({
      userMessage: "Failed to fetch models from the configured providers",
      retryable: true
    })
  })

  it("propagates cancellation through aggregate model discovery", async () => {
    const controller = new AbortController()
    const getModels = vi.fn(async (signal?: AbortSignal) => {
      await new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Cancelled", "AbortError"))
        })
      })
      return []
    })
    mocks.getProviders.mockResolvedValue([configs[0]])
    mocks.getProvider.mockResolvedValue({ id: "ollama", getModels })

    const pending = ProviderRpcService.listModels(
      { enabledOnly: true },
      controller.signal
    )
    await vi.waitFor(() => expect(getModels).toHaveBeenCalled())
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(getModels).toHaveBeenCalledWith(controller.signal)
  })

  it("upserts and removes providers without returning credentials", async () => {
    const created = await ProviderRpcService.upsert({
      target: "new",
      provider: {
        name: "New remote",
        baseUrl: "https://example.test/v1",
        wire: "openai",
        apiKey: "private-new-key"
      }
    })

    expect(created.provider).toMatchObject({
      id: "custom:openai:new",
      hasApiKey: true
    })
    expect(created.provider).not.toHaveProperty("apiKey")

    await expect(
      ProviderRpcService.remove({ providerId: "custom:openai:new" })
    ).resolves.toEqual({ removedProviderId: "custom:openai:new" })
    expect(mocks.removeCustomProvider).toHaveBeenCalledWith("custom:openai:new")
  })

  it("probes capabilities in background and persists partial evidence", async () => {
    const result = await ProviderRpcService.probeModelCapabilities({
      providerId: "custom:openai:remote",
      modelName: "vision-model"
    })

    expect(result).toMatchObject({
      toolCalling: true,
      reasoning: false,
      vision: true
    })
    expect(mocks.setCapabilityProbe).toHaveBeenCalledWith(
      "custom:openai:remote",
      "vision-model",
      result
    )
  })
})
