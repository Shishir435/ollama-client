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
  capabilities: { modelDetails: true },
  getModelDetails: vi.fn()
}

const lmStudio = {
  id: "lm studio",
  config: { id: "lm studio", baseUrl: "http://localhost:1234/v1" },
  capabilities: { modelDetails: false }
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
  it("normalizes Ollama's /api/ps shape", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: "llama3:8b",
            size: 1024,
            details: {
              family: "llama",
              parameter_size: "8B",
              quantization_level: "Q4_0"
            }
          }
        ]
      })
    )

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
  })

  it("normalizes LM Studio's differently named fields", async () => {
    // The old handler passed LM Studio's entries through untouched, so the card
    // rendered `undefined` for family, size, and quantization.
    mocks.getProvider.mockResolvedValue(lmStudio)
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        data: [{ id: "qwen3-8b", arch: "qwen3", quantization: "Q4_K_M" }]
      })
    )

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
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "http://localhost:1234/api/v1/models"
    )
  })

  it("throws an AppError the RPC server can classify", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 503))

    await expect(ModelRpcService.listLoaded({})).rejects.toMatchObject({
      status: 503,
      retryable: true
    })
  })
})

describe("ModelRpcService.unload", () => {
  it("reports whether the keep-alive eviction actually took", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ done_reason: "unload" }))
    await expect(ModelRpcService.unload({ model: "llama3" })).resolves.toEqual({
      unloaded: true
    })

    vi.mocked(fetch).mockResolvedValue(jsonResponse({ done_reason: "stop" }))
    await expect(ModelRpcService.unload({ model: "llama3" })).resolves.toEqual({
      unloaded: false
    })
  })
})

describe("ModelRpcService.warmup", () => {
  it("does nothing when the model opts out of warm-on-select", async () => {
    mocks.storageGet.mockResolvedValue({ llama3: { warm_on_select: false } })

    await expect(ModelRpcService.warmup({ model: "llama3" })).resolves.toEqual({
      warmed: false,
      unloadedPrevious: false
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("warms once and then respects the cooldown", async () => {
    mocks.storageGet.mockResolvedValue({
      "cooldown-model": { warm_on_select: true, keep_alive: "10m" }
    })
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}))

    const first = await ModelRpcService.warmup({ model: "cooldown-model" })
    const second = await ModelRpcService.warmup({ model: "cooldown-model" })

    expect(first.warmed).toBe(true)
    expect(second.warmed).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("releases the previous model when it is configured to unload on switch", async () => {
    mocks.storageGet.mockResolvedValue({
      "new-model": { warm_on_select: false },
      "old-model": { unload_on_switch: true }
    })
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}))

    const result = await ModelRpcService.warmup({
      model: "new-model",
      previousModel: "old-model"
    })

    expect(result).toEqual({ warmed: false, unloadedPrevious: true })
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "http://localhost:11434/api/chat"
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
    expect(fetch).not.toHaveBeenCalled()
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
