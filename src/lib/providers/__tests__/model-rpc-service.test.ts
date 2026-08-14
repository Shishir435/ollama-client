import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getProvider: vi.fn(),
  getProviderForModel: vi.fn(),
  getProviderConfig: vi.fn(),
  storageGet: vi.fn(),
  assertProviderEnabled: vi.fn()
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProvider: mocks.getProvider,
    getProviderForModel: mocks.getProviderForModel
  }
}))
vi.mock("@/lib/providers/manager", () => ({
  ProviderManager: { getProviderConfig: mocks.getProviderConfig }
}))
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: mocks.storageGet
}))
vi.mock("@/lib/providers/provider-policy", () => ({
  assertProviderEnabled: mocks.assertProviderEnabled
}))

import { ModelRpcService } from "../model-rpc-service"

const ollama = {
  id: "ollama",
  config: { id: "ollama", baseUrl: "http://localhost:11434" },
  capabilities: { modelDetails: true, modelUnload: true },
  getModelDetails: vi.fn(),
  modelLifecycle: {
    listLoadedModels: vi.fn(),
    unloadModel: vi.fn(),
    warmModel: vi.fn()
  }
}

const lmStudio = {
  id: "lm studio",
  config: { id: "lm studio", baseUrl: "http://localhost:1234/v1" },
  capabilities: { modelDetails: false, modelUnload: true },
  modelLifecycle: {
    listLoadedModels: vi.fn(),
    unloadModel: vi.fn()
  }
}

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    statusText: ok ? "OK" : "Service Unavailable",
    json: async () => body,
    text: async () => JSON.stringify(body)
  }) as unknown as Response

beforeEach(() => {
  vi.clearAllMocks()
  ollama.getModelDetails = vi.fn()
  ollama.modelLifecycle.listLoadedModels.mockResolvedValue([])
  ollama.modelLifecycle.unloadModel.mockResolvedValue(true)
  ollama.modelLifecycle.warmModel.mockResolvedValue(undefined)
  lmStudio.modelLifecycle.listLoadedModels.mockResolvedValue([])
  lmStudio.modelLifecycle.unloadModel.mockResolvedValue(true)
  mocks.getProvider.mockResolvedValue(ollama)
  mocks.getProviderForModel.mockResolvedValue(ollama)
  mocks.getProviderConfig.mockResolvedValue(ollama.config)
  mocks.storageGet.mockResolvedValue({})
  vi.stubGlobal("fetch", vi.fn())
})

describe("ModelRpcService.getDetails", () => {
  it("reports a provider that cannot self-report instead of an empty result", async () => {
    mocks.getProviderForModel.mockResolvedValue(lmStudio)

    await expect(
      ModelRpcService.getDetails({ model: "qwen3" })
    ).resolves.toEqual({
      providerId: "lm studio",
      supportsDetails: false,
      details: null
    })
  })

  it("strips the fields the model card never renders", async () => {
    ollama.getModelDetails.mockResolvedValue({
      license: "a".repeat(10_000),
      modelfile: "FROM llama",
      template: "{{ .Prompt }}",
      details: { family: "llama" },
      capabilities: ["completion", "tools"]
    })

    const result = await ModelRpcService.getDetails({ model: "llama3" })

    expect(result.supportsDetails).toBe(true)
    expect(result.details).toEqual({
      details: { family: "llama" },
      capabilities: ["completion", "tools"]
    })
  })
})

describe("ModelRpcService.listLoaded", () => {
  it("delegates loaded-model listing to the provider lifecycle port", async () => {
    ollama.modelLifecycle.listLoadedModels.mockResolvedValue([
      {
        name: "llama3:8b",
        sizeBytes: 1024,
        family: "llama",
        parameterSize: "8B",
        quantizationLevel: "Q4_0"
      }
    ])

    await expect(ModelRpcService.listLoaded({})).resolves.toEqual({
      models: [
        {
          name: "llama3:8b",
          sizeBytes: 1024,
          family: "llama",
          parameterSize: "8B",
          quantizationLevel: "Q4_0"
        }
      ]
    })
    expect(ollama.modelLifecycle.listLoadedModels).toHaveBeenCalledOnce()
  })

  it("uses the requested provider's lifecycle port", async () => {
    mocks.getProvider.mockResolvedValue(lmStudio)
    lmStudio.modelLifecycle.listLoadedModels.mockResolvedValue([
      {
        name: "qwen3-8b",
        sizeBytes: 0,
        family: "qwen3",
        parameterSize: "",
        quantizationLevel: "Q4_K_M"
      }
    ])

    await expect(
      ModelRpcService.listLoaded({ providerId: "lm studio" })
    ).resolves.toEqual({
      models: [
        {
          name: "qwen3-8b",
          sizeBytes: 0,
          family: "qwen3",
          parameterSize: "",
          quantizationLevel: "Q4_K_M"
        }
      ]
    })
    expect(lmStudio.modelLifecycle.listLoadedModels).toHaveBeenCalledOnce()
  })

  it("returns an empty list when the provider has no lifecycle port", async () => {
    mocks.getProvider.mockResolvedValue({
      ...lmStudio,
      modelLifecycle: undefined
    })

    await expect(ModelRpcService.listLoaded({})).resolves.toEqual({
      models: []
    })
  })
})

describe("ModelRpcService.unload", () => {
  it("delegates unload and preserves the provider's result", async () => {
    await expect(ModelRpcService.unload({ model: "llama3" })).resolves.toEqual({
      unloaded: true
    })

    ollama.modelLifecycle.unloadModel.mockResolvedValue(false)
    await expect(ModelRpcService.unload({ model: "llama3" })).resolves.toEqual({
      unloaded: false
    })
    expect(ollama.modelLifecycle.unloadModel).toHaveBeenCalledWith(
      "llama3",
      undefined
    )
  })
})

describe("ModelRpcService.warmup", () => {
  it("does nothing when the model opts out of warm-on-select", async () => {
    mocks.storageGet.mockResolvedValue({ llama3: { warm_on_select: false } })

    await expect(ModelRpcService.warmup({ model: "llama3" })).resolves.toEqual({
      warmed: false,
      unloadedPrevious: false
    })
    expect(ollama.modelLifecycle.warmModel).not.toHaveBeenCalled()
  })

  it("warms once and then respects the cooldown", async () => {
    mocks.storageGet.mockResolvedValue({
      "cooldown-model": { warm_on_select: true, keep_alive: "10m" }
    })
    const first = await ModelRpcService.warmup({ model: "cooldown-model" })
    const second = await ModelRpcService.warmup({ model: "cooldown-model" })

    expect(first.warmed).toBe(true)
    expect(second.warmed).toBe(false)
    expect(ollama.modelLifecycle.warmModel).toHaveBeenCalledTimes(1)
  })

  it("releases the previous model when it is configured to unload on switch", async () => {
    mocks.storageGet.mockResolvedValue({
      "new-model": { warm_on_select: false },
      "old-model": { unload_on_switch: true }
    })
    const result = await ModelRpcService.warmup({
      model: "new-model",
      previousModel: "old-model"
    })

    expect(result).toEqual({ warmed: false, unloadedPrevious: true })
    expect(ollama.modelLifecycle.unloadModel).toHaveBeenCalledWith(
      "old-model",
      undefined
    )
  })

  it("refuses to warm a disabled provider", async () => {
    mocks.storageGet.mockResolvedValue({
      "blocked-model": { warm_on_select: true }
    })
    mocks.assertProviderEnabled.mockImplementation(() => {
      throw new Error("provider disabled")
    })

    await expect(
      ModelRpcService.warmup({ model: "blocked-model" })
    ).rejects.toThrow("provider disabled")
    expect(ollama.modelLifecycle.warmModel).not.toHaveBeenCalled()
  })
})

describe("ModelRpcService library lookups", () => {
  it("encodes the query rather than interpolating it raw", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "<html></html>"
    } as unknown as Response)

    await ModelRpcService.searchLibrary({ query: "llama 3/vision" })

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
      "/search?q=llama%203%2Fvision"
    )
  })

  it("surfaces a failed catalog fetch instead of returning empty HTML", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 404))

    await expect(
      ModelRpcService.getLibraryVariants({ name: "nope" })
    ).rejects.toMatchObject({ status: 404 })
  })
})
