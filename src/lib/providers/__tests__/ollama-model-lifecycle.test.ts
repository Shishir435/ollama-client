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

    await makeProvider().modelLifecycle.warmModel("llama3", {
      keep_alive: "10m"
    })

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

  it("warms with the load options the chat request sends, so chat finds it loaded", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)
    const provider = makeProvider()
    const load = {
      num_ctx: 65536,
      num_gpu: 99,
      num_batch: 512,
      num_thread: 8,
      keep_alive: "30m"
    }

    await provider.modelLifecycle.warmModel("qwen3", load)
    const warmup = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ message: { content: "" }, done: true }) + "\n"
            )
          )
          controller.close()
        }
      })
    } as Response)
    await provider.streamChat(
      {
        model: "qwen3",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.2,
        ...load
      },
      () => {}
    )
    const chat = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))

    expect(warmup.options).toEqual({
      num_ctx: 65536,
      num_gpu: 99,
      num_batch: 512,
      num_thread: 8
    })
    expect(warmup.keep_alive).toBe(chat.keep_alive)
    for (const key of ["num_ctx", "num_gpu", "num_batch", "num_thread"]) {
      expect(warmup.options[key]).toBe(chat.options[key])
    }
  })
})
