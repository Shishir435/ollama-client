import { afterEach, describe, expect, it, vi } from "vitest"

import { LlamaCppProvider } from "../llama-cpp"
import { LMStudioProvider } from "../lm-studio"
import { OllamaProvider } from "../ollama"
import { ProviderId, ProviderType } from "../types"
import {
  collectChunks,
  jsonResponse,
  openAIStream,
  requestBody,
  streamResponse,
  weatherTool
} from "./provider-contract-fixtures"

afterEach(() => vi.restoreAllMocks())

describe("local provider wire contracts", () => {
  it("keeps Ollama on its native chat stream including thinking and tools", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        `${JSON.stringify({ message: { thinking: "plan" }, done: false })}\n`,
        `${JSON.stringify({ message: { content: "done" }, done: false })}\n`,
        `${JSON.stringify({
          message: {
            tool_calls: [
              {
                id: "call-1",
                function: {
                  name: "get_weather",
                  arguments: { city: "Paris" }
                }
              }
            ]
          },
          done: true,
          prompt_eval_count: 7,
          eval_count: 3
        })}\n`
      ])
    )
    const collected = collectChunks()

    await new OllamaProvider({
      id: ProviderId.OLLAMA,
      type: ProviderType.OLLAMA,
      enabled: true,
      name: "Ollama",
      baseUrl: "http://localhost:11434"
    }).streamChat(
      {
        model: "qwen3.5:latest",
        messages: [{ role: "user", content: "Weather?" }],
        tools: [weatherTool]
      },
      collected.onChunk
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({ method: "POST" })
    )
    expect(requestBody(fetchMock)).toMatchObject({
      model: "qwen3.5:latest",
      stream: true,
      tools: [
        {
          type: "function",
          function: expect.objectContaining({ name: "get_weather" })
        }
      ]
    })
    expect(collected.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ thinkingDelta: "plan" }),
        expect.objectContaining({ delta: "done" }),
        expect.objectContaining({
          toolCalls: [
            {
              id: "call-1",
              name: "get_weather",
              arguments: { city: "Paris" }
            }
          ]
        }),
        expect.objectContaining({
          done: true,
          metrics: expect.objectContaining({
            prompt_eval_count: 7,
            eval_count: 3
          })
        })
      ])
    )
  })

  it("keeps LM Studio on OpenAI chat while requesting streamed usage", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse(openAIStream()))
    const collected = collectChunks()

    await new LMStudioProvider({
      id: ProviderId.LM_STUDIO,
      type: ProviderType.OPENAI,
      enabled: true,
      name: "LM Studio",
      baseUrl: "http://localhost:1234/v1"
    }).streamChat(
      {
        model: "qwen3-8b",
        messages: [{ role: "user", content: "Weather?" }],
        tools: [weatherTool]
      },
      collected.onChunk
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:1234/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    )
    expect(requestBody(fetchMock)).toMatchObject({
      model: "qwen3-8b",
      stream: true,
      stream_options: { include_usage: true }
    })
    expect(
      collected.chunks.find((chunk) => chunk.toolCalls)?.toolCalls
    ).toEqual([
      {
        id: "call-1",
        name: "get_weather",
        arguments: { city: "Paris" }
      }
    ])
  })

  it("accepts llama.cpp's hybrid model catalog metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "Qwen3.5-9B-Q4_K_M.gguf",
            created: 1_700_000_000,
            meta: {
              n_params: 9_000_000_000,
              n_ctx_train: 262_144,
              size: "6123456789"
            }
          }
        ]
      })
    )

    const models = await new LlamaCppProvider({
      id: ProviderId.LLAMA_CPP,
      type: ProviderType.OPENAI,
      enabled: true,
      name: "llama.cpp",
      baseUrl: "http://localhost:8000/v1"
    }).getModels()

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/v1/models",
      undefined
    )
    expect(models).toEqual([
      expect.objectContaining({
        name: "Qwen3.5-9B-Q4_K_M.gguf",
        size: 6_123_456_789,
        details: expect.objectContaining({
          family: "llama-cpp",
          parameter_size: "9B"
        }),
        capabilityHints: { contextLength: 262_144 }
      })
    ])
  })
})
