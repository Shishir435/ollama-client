import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OllamaProvider } from "../ollama"
import { ProviderId, ProviderType } from "../types"

const makeProvider = () =>
  new OllamaProvider({
    id: ProviderId.OLLAMA,
    type: ProviderType.OLLAMA,
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    enabled: true
  })

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("OllamaProvider.modelLifecycle", () => {
  it("normalizes /api/ps entries inside the adapter", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
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
    } as Response)

    await expect(
      makeProvider().modelLifecycle.listLoadedModels()
    ).resolves.toEqual([
      {
        name: "llama3:8b",
        sizeBytes: 1024,
        family: "llama",
        parameterSize: "8B",
        quantizationLevel: "Q4_0"
      }
    ])
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "http://localhost:11434/api/ps"
    )
  })

  it("owns keep-alive eviction and reports whether it took", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ done_reason: "unload" })
    } as Response)

    await expect(
      makeProvider().modelLifecycle.unloadModel("llama3")
    ).resolves.toBe(true)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "llama3",
          messages: [],
          keep_alive: 0
        })
      })
    )
  })

  it("owns the no-op generate warmup wire format", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await makeProvider().modelLifecycle.warmModel("llama3", "10m")

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "llama3",
          prompt: "",
          stream: false,
          keep_alive: "10m"
        })
      })
    )
  })
})
