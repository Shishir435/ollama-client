import { beforeEach, describe, expect, it, vi } from "vitest"
import { KoboldCppProvider } from "@/lib/providers/koboldcpp"
import { LlamaCppProvider } from "@/lib/providers/llama-cpp"
import { LMStudioProvider } from "@/lib/providers/lm-studio"
import { LocalAIProvider } from "@/lib/providers/localai"
import { OllamaProvider } from "@/lib/providers/ollama"
import { OpenAICompatibleProvider } from "@/lib/providers/openai-compatible"
import { VllmProvider } from "@/lib/providers/vllm"
import { ProviderId, ProviderType } from "../types"

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init
  })

const textResponse = (body: string, init: ResponseInit = {}) =>
  new Response(body, init)

const streamResponse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      }
    })
  )

describe("provider contracts", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.fetch = vi.fn()
  })

  it("Ollama parses model lists and streaming chat chunks", async () => {
    const provider = new OllamaProvider({
      id: ProviderId.OLLAMA,
      name: "Ollama",
      type: ProviderType.OLLAMA,
      enabled: true,
      baseUrl: "http://ollama.test"
    })

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          models: [
            {
              name: "llama3",
              model: "llama3",
              size: 1,
              details: { family: "llama" }
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        streamResponse([
          `${JSON.stringify({ message: { content: "hel" }, done: false })}\n`,
          `${JSON.stringify({
            message: { content: "lo" },
            done: true,
            eval_count: 2
          })}\n`
        ])
      )

    await expect(provider.getModels()).resolves.toEqual([
      expect.objectContaining({ name: "llama3" })
    ])

    const chunks: unknown[] = []
    await provider.streamChat(
      {
        model: "llama3",
        messages: [{ role: "user", content: "hi" }]
      },
      (chunk) => chunks.push(chunk)
    )

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://ollama.test/api/chat",
      expect.objectContaining({ method: "POST" })
    )
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ delta: "hel", done: false }),
        expect.objectContaining({
          delta: "lo",
          done: true,
          metrics: expect.objectContaining({ eval_count: 2 })
        }),
        expect.objectContaining({ done: true })
      ])
    )
  })

  it("Ollama surfaces model-list fetch errors", async () => {
    const provider = new OllamaProvider({
      id: ProviderId.OLLAMA,
      name: "Ollama",
      type: ProviderType.OLLAMA,
      enabled: true,
      baseUrl: "http://ollama.test"
    })
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"))

    await expect(provider.getModels()).rejects.toThrow("offline")
  })

  it("OpenAI-compatible providers parse model lists and SSE chunks", async () => {
    const providers = [
      new OpenAICompatibleProvider({
        id: ProviderId.OPENAI,
        name: "OpenAI",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "http://openai.test/v1",
        apiKey: "key"
      }),
      new VllmProvider({
        id: ProviderId.VLLM,
        name: "vLLM",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "http://vllm.test/v1"
      }),
      new LocalAIProvider({
        id: ProviderId.LOCALAI,
        name: "LocalAI",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "http://localai.test/v1"
      }),
      new KoboldCppProvider({
        id: ProviderId.KOBOLDCPP,
        name: "KoboldCPP",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: "http://kobold.test/v1"
      })
    ]

    for (const provider of providers) {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ data: [{ id: "chat-model" }] }))
        .mockResolvedValueOnce(
          streamResponse([
            `data: ${JSON.stringify({
              choices: [{ delta: { content: "ok" } }]
            })}\n\n`,
            `data: ${JSON.stringify({
              usage: { prompt_tokens: 3, completion_tokens: 1 }
            })}\n\n`,
            "data: [DONE]\n\n"
          ])
        )

      await expect(provider.getModels()).resolves.toEqual([
        expect.objectContaining({ name: "chat-model" })
      ])

      const chunks: unknown[] = []
      await provider.streamChat(
        { model: "chat-model", messages: [{ role: "user", content: "hi" }] },
        (chunk) => chunks.push(chunk)
      )

      expect(chunks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ delta: "ok", done: false }),
          expect.objectContaining({
            done: false,
            metrics: expect.objectContaining({
              prompt_eval_count: 3,
              eval_count: 1
            })
          }),
          expect.objectContaining({ done: true })
        ])
      )
    }
  })

  it("OpenAI surfaces useful model-list and chat errors", async () => {
    const provider = new OpenAICompatibleProvider({
      id: ProviderId.OPENAI,
      name: "OpenAI",
      type: ProviderType.OPENAI,
      enabled: true,
      baseUrl: "http://openai.test/v1"
    })

    vi.mocked(fetch)
      .mockResolvedValueOnce(textResponse("bad", { status: 500 }))
      .mockResolvedValueOnce(textResponse("nope", { status: 401 }))

    await expect(provider.getModels()).rejects.toThrow(
      "Model list failed (500)"
    )
    await expect(
      provider.streamChat(
        { model: "chat-model", messages: [{ role: "user", content: "hi" }] },
        vi.fn()
      )
    ).rejects.toThrow("OpenAI Error (401): nope")
  })

  it("LM Studio prefers /api/v0/models rich metadata and falls back to OpenAI models", async () => {
    const provider = new LMStudioProvider({
      id: ProviderId.LM_STUDIO,
      name: "LM Studio",
      type: ProviderType.OPENAI,
      enabled: true,
      baseUrl: "http://lmstudio.test/v1"
    })

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: "lm-model",
            arch: "llama",
            quantization: "Q4_K_M",
            max_context_length: 8192
          }
        ]
      })
    )

    await expect(provider.getModels()).resolves.toEqual([
      expect.objectContaining({
        name: "lm-model",
        details: expect.objectContaining({
          family: "llama",
          quantization_level: "Q4_K_M"
        })
      })
    ])

    vi.mocked(fetch)
      .mockResolvedValueOnce(textResponse("not found", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "fallback-model" }] }))

    await expect(provider.getModels()).resolves.toEqual([
      expect.objectContaining({ name: "fallback-model" })
    ])
  })

  it("llama.cpp parses rich /v1/models metadata and throws when unreachable", async () => {
    const provider = new LlamaCppProvider({
      id: ProviderId.LLAMA_CPP,
      name: "llama.cpp",
      type: ProviderType.OPENAI,
      enabled: true,
      baseUrl: "http://llamacpp.test/v1"
    })

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: "llama-cpp-model",
            created: 1_700_000_000,
            meta: { n_params: 7_000_000_000, size: 1234 }
          }
        ]
      })
    )

    await expect(provider.getModels()).resolves.toEqual([
      expect.objectContaining({
        name: "llama-cpp-model",
        size: 1234,
        details: expect.objectContaining({ parameter_size: "7B" })
      })
    ])

    vi.mocked(fetch).mockRejectedValue(new Error("offline"))
    await expect(provider.getModels()).rejects.toThrow(
      "Failed to connect to llama.cpp server"
    )
  })
})
