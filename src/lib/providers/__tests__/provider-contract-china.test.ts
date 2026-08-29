import { afterEach, describe, expect, it, vi } from "vitest"

import { OpenAICompatibleProvider } from "../openai-compatible"
import { ProviderType } from "../types"
import {
  collectChunks,
  openAIStream,
  requestBody,
  streamResponse,
  weatherTool
} from "./provider-contract-fixtures"

interface HostedCompatibilityCase {
  name: string
  baseUrl: string
  model: string
}

const providers: HostedCompatibilityCase[] = [
  {
    name: "DeepSeek",
    baseUrl: "https://gateway.test/deepseek/v1",
    model: "deepseek-v4-flash"
  },
  {
    name: "Qwen / DashScope",
    baseUrl: "https://gateway.test/qwen/compatible-mode/v1",
    model: "qwen3.5-plus"
  },
  {
    name: "Kimi / Moonshot",
    baseUrl: "https://gateway.test/kimi/v1",
    model: "kimi-k2.6"
  },
  {
    name: "Z.AI / GLM",
    baseUrl: "https://gateway.test/glm/api/paas/v4",
    model: "glm-5.3"
  }
]

afterEach(() => vi.restoreAllMocks())

describe("Chinese frontier provider OpenAI compatibility contracts", () => {
  it.each(
    providers
  )("$name preserves its endpoint, model id, auth, reasoning, tools, and usage", async ({
    name,
    baseUrl,
    model
  }) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse(openAIStream()))
    const collected = collectChunks()

    await new OpenAICompatibleProvider({
      id: `custom:openai:${name.toLowerCase().replaceAll(/\W+/g, "-")}`,
      type: ProviderType.OPENAI,
      enabled: true,
      name,
      baseUrl,
      apiKey: "sk-provider-test"
    }).streamChat(
      {
        model,
        messages: [{ role: "user", content: "Weather?" }],
        num_predict: 128,
        tools: [weatherTool]
      },
      collected.onChunk
    )

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/chat/completions`,
      expect.objectContaining({ method: "POST" })
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(request.headers).toMatchObject({
      Authorization: "Bearer sk-provider-test"
    })
    expect(requestBody(fetchMock)).toMatchObject({
      model,
      stream: true,
      max_tokens: 128,
      tools: [
        {
          type: "function",
          function: expect.objectContaining({ name: "get_weather" })
        }
      ]
    })
    expect(requestBody(fetchMock).stream_options).toBeUndefined()
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
})
