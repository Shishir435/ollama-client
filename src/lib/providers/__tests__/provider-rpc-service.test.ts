import { beforeEach, describe, expect, it, vi } from "vitest"

// The catalog-support marker is exercised for real here — the whole point of
// it is that a second discovery pass reads what the first one wrote — so this
// file backs storage with a map instead of the suite-wide no-op stub.
const storageBacking = vi.hoisted(() => new Map<string, unknown>())

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => storageBacking.get(key)),
  setPlasmoStoredValue: vi.fn(async (key: string, value: unknown) => {
    storageBacking.set(key, value)
  })
}))

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

import { createAppError } from "@/lib/error-utils"
import {
  clearModelCatalogSupport,
  getModelCatalogSupport
} from "../model-catalog-support"
import { ProviderRpcService } from "../provider-rpc-service"
import { type ProviderConfig, ProviderType } from "../types"

const catalogAbsent = () =>
  createAppError("Model list failed (404)", { kind: "provider", status: 404 })

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

beforeEach(async () => {
  vi.clearAllMocks()
  // The catalog-support marker is real storage, shared across tests in this
  // file. Clear it so one test's learned answer cannot silence another's
  // discovery call.
  for (const config of configs) {
    await clearModelCatalogSupport(String(config.id))
  }
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
      // One discovered plus the declared id — the same set the model menu gets.
      modelCount: 2,
      modelListSupported: true
    })
    expect(result).not.toHaveProperty("apiKey")
  })

  it("confirms a catalog-less endpoint against chat before calling it reachable", async () => {
    const streamChat = vi.fn(
      async (
        _request: unknown,
        onChunk: (chunk: { delta: string }) => void
      ) => {
        onChunk({ delta: "p" })
      }
    )
    mocks.getProviderWithConfig.mockResolvedValue({
      id: "ollama",
      getModels: async () => {
        throw catalogAbsent()
      },
      streamChat
    })

    await expect(
      ProviderRpcService.testConnection({ target: "draft", config: configs[0] })
    ).resolves.toMatchObject({
      providerId: "ollama",
      reachable: true,
      modelCount: 1,
      modelListSupported: false
    })
    // Probed with the declared id, and cheaply: this runs against somebody's
    // metered endpoint on a button press.
    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "manual-model", max_tokens: 1 }),
      expect.any(Function),
      expect.any(AbortSignal)
    )
  })

  it("reports a wrong base URL rather than a missing catalog when chat is missing too", async () => {
    mocks.getProviderWithConfig.mockResolvedValue({
      id: "ollama",
      getModels: async () => {
        throw catalogAbsent()
      },
      streamChat: async () => {
        throw catalogAbsent()
      }
    })

    // A mistyped base URL 404s on the catalog exactly like a chat-only gateway
    // does; only the chat endpoint tells them apart.
    await expect(
      ProviderRpcService.testConnection({ target: "draft", config: configs[0] })
    ).rejects.toMatchObject({
      status: 404,
      userMessage: expect.stringContaining("Check the base URL")
    })
    // And the answer recorded on the way in is dropped, so fixing the URL gets
    // a clean probe instead of a day of silence.
    expect(await getModelCatalogSupport(configs[0])).toBeNull()
  })

  it("does not claim reachability, or spend a chat request, on a background check", async () => {
    const streamChat = vi.fn()
    mocks.getProvider.mockResolvedValue({
      id: "ollama",
      getModels: async () => {
        throw catalogAbsent()
      },
      streamChat
    })

    const result = await ProviderRpcService.testConnection({
      target: "stored",
      providerId: "ollama"
    })

    expect(streamChat).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      reachable: false,
      modelCount: 1,
      modelListSupported: false
    })
  })

  it("stops asking an endpoint that already said it has no catalog", async () => {
    const getModels = vi.fn(async () => {
      throw catalogAbsent()
    })
    mocks.getProvider.mockImplementation(async (id: string) => ({
      id,
      getModels
    }))
    mocks.getProviders.mockResolvedValue([configs[0]])

    const first = await ProviderRpcService.listModels({ enabledOnly: true })
    const second = await ProviderRpcService.listModels({ enabledOnly: true })

    // One request, ever. The second refresh is served from the declared ids.
    expect(getModels).toHaveBeenCalledTimes(1)
    expect(second.models.map(({ name }) => name)).toEqual(
      first.models.map(({ name }) => name)
    )
    expect(second.models.map(({ name }) => name)).toEqual(["manual-model"])
    // Nothing failed: the provider works, it just has nothing to discover.
    expect(second.failures).toEqual([])
  })

  it("re-probes the catalog when the user tests the connection", async () => {
    const listModelsProvider = vi.fn(async () => {
      throw catalogAbsent()
    })
    mocks.getProvider.mockImplementation(async (id: string) => ({
      id,
      getModels: listModelsProvider
    }))
    mocks.getProviders.mockResolvedValue([configs[0]])
    await ProviderRpcService.listModels({ enabledOnly: true })

    const draftGetModels = vi.fn(async () => [model("now-listed")])
    mocks.getProviderWithConfig.mockResolvedValue({
      id: "ollama",
      getModels: draftGetModels
    })

    const result = await ProviderRpcService.testConnection({
      target: "draft",
      config: configs[0]
    })

    // Pressing Test is a deliberate re-check: a server that gained the endpoint
    // must not stay written off because of what it answered an hour ago.
    expect(draftGetModels).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ modelListSupported: true, modelCount: 2 })
  })

  it("reports a catalog-less provider that declares no models", async () => {
    mocks.getProvider.mockImplementation(async (id: string) => ({
      id,
      getModels: async () => {
        throw catalogAbsent()
      }
    }))
    mocks.getProviders.mockResolvedValue([configs[1]])

    const result = await ProviderRpcService.listModels({ enabledOnly: true })

    expect(result.models).toEqual([])
    expect(result.failures).toEqual([
      {
        providerId: "custom:openai:remote",
        providerName: "Remote",
        code: "model_list_unsupported"
      }
    ])
  })

  it("keeps a rejected credential a failure rather than a missing model list", async () => {
    mocks.getProviderWithConfig.mockResolvedValue({
      id: "ollama",
      getModels: async () => {
        throw createAppError("Unauthorized", { kind: "provider", status: 401 })
      }
    })

    await expect(
      ProviderRpcService.testConnection({ target: "draft", config: configs[0] })
    ).rejects.toMatchObject({ status: 401 })
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
      {
        providerId: "custom:openai:remote",
        providerName: "Remote",
        code: "request_failed"
      }
    ])
  })

  it("keeps declared model ids when discovery fails outright", async () => {
    mocks.getProvider.mockRejectedValue(new Error("offline"))

    const result = await ProviderRpcService.listModels({ enabledOnly: true })

    // The provider without declared ids contributes nothing and is reported;
    // the one with them still reaches the menu, which is the whole point.
    expect(result.models.map(({ name }) => name)).toEqual(["manual-model"])
    expect(result.failures).toEqual([
      {
        providerId: "custom:openai:remote",
        providerName: "Remote",
        code: "request_failed"
      },
      {
        providerId: "ollama",
        providerName: "Ollama",
        code: "discovery_unavailable"
      }
    ])
  })

  it("fails when every selected provider is unavailable and none declares a model", async () => {
    mocks.getProviders.mockResolvedValue([{ ...configs[0], customModels: [] }])
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
