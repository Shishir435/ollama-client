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
    toolCallingMode: "native-user-results",
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

  it("toggles enabled with a partial update so stored credentials survive", async () => {
    const result = await ProviderRpcService.setEnabled({
      providerId: "ollama",
      enabled: true
    })

    expect(mocks.updateProviderConfig).toHaveBeenCalledWith("ollama", {
      enabled: true
    })
    expect(result.provider).toMatchObject({ id: "ollama", hasApiKey: true })
    expect(result.provider).not.toHaveProperty("apiKey")
  })

  it("rejects enabling a provider that is not configured", async () => {
    await expect(
      ProviderRpcService.setEnabled({ providerId: "missing", enabled: true })
    ).rejects.toMatchObject({ status: 404 })
    expect(mocks.updateProviderConfig).not.toHaveBeenCalled()
  })

  it("probes capabilities in background and persists partial evidence", async () => {
    const result = await ProviderRpcService.probeModelCapabilities({
      providerId: "custom:openai:remote",
      modelName: "vision-model"
    })

    expect(result).toMatchObject({
      toolCalling: true,
      toolCallingMode: "native-user-results",
      reasoning: false,
      vision: true
    })
    expect(mocks.setCapabilityProbe).toHaveBeenCalledWith(
      "custom:openai:remote",
      "vision-model",
      result
    )
  })

  it("runs the three probes one at a time", async () => {
    // Concurrent probes queue behind a local server's cold model load and burn
    // their own timeouts waiting, which made the first Detect miss reasoning and
    // a second Detect find it.
    const order: string[] = []
    const track =
      (name: string, value: Record<string, unknown>) => async () => {
        order.push(`${name}:start`)
        await Promise.resolve()
        order.push(`${name}:end`)
        return { ...value, probedAt: 1 }
      }
    mocks.probeToolCalling.mockImplementation(
      track("tool", { toolCalling: true })
    )
    mocks.probeReasoning.mockImplementation(
      track("reasoning", { reasoning: true })
    )
    mocks.probeVision.mockImplementation(track("vision", { vision: true }))

    await ProviderRpcService.probeModelCapabilities({
      providerId: "custom:openai:remote",
      modelName: "vision-model"
    })

    expect(order).toEqual([
      "tool:start",
      "tool:end",
      "reasoning:start",
      "reasoning:end",
      "vision:start",
      "vision:end"
    ])
  })

  it("reports a check that did not finish instead of calling it unsupported", async () => {
    mocks.probeToolCalling.mockResolvedValue({
      toolCalling: true,
      probedAt: 1
    })
    mocks.probeReasoning.mockRejectedValue(new Error("timed out"))
    mocks.probeVision.mockResolvedValue({ vision: true, probedAt: 1 })

    const result = await ProviderRpcService.probeModelCapabilities({
      providerId: "custom:openai:remote",
      modelName: "vision-model"
    })

    expect(result.incomplete).toEqual(["reasoning"])
    expect(result).not.toHaveProperty("reasoning")

    // The run report is not evidence about the model, so it is not stored.
    const [, , persisted] = mocks.setCapabilityProbe.mock.calls.at(-1) as [
      string,
      string,
      Record<string, unknown>
    ]
    expect(persisted).not.toHaveProperty("incomplete")
    expect(persisted).toMatchObject({ toolCalling: true, vision: true })
  })

  it("still throws when every check fails", async () => {
    mocks.probeToolCalling.mockRejectedValue(new Error("server down"))
    mocks.probeReasoning.mockRejectedValue(new Error("server down"))
    mocks.probeVision.mockRejectedValue(new Error("server down"))

    await expect(
      ProviderRpcService.probeModelCapabilities({
        providerId: "custom:openai:remote",
        modelName: "vision-model"
      })
    ).rejects.toThrow("server down")
  })
})
