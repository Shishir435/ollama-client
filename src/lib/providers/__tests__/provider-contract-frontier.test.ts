import { afterEach, describe, expect, it, vi } from "vitest"

import { AnthropicProvider } from "../anthropic"
import { OpenAICompatibleProvider } from "../openai-compatible"
import { ProviderServiceProfile, ProviderType } from "../types"
import {
  collectChunks,
  openAIStream,
  requestBody,
  streamResponse,
  weatherTool
} from "./provider-contract-fixtures"

afterEach(() => vi.restoreAllMocks())

describe("frontier provider wire contracts", () => {
  it("uses OpenAI's hosted token field, auth, vision, tools, and usage stream", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse(openAIStream()))
    const collected = collectChunks()

    await new OpenAICompatibleProvider({
      id: "custom:openai:openai",
      type: ProviderType.OPENAI,
      serviceProfile: ProviderServiceProfile.OPENAI,
      enabled: true,
      name: "OpenAI",
      // A service profile selects the wire dialect; users may route it through
      // a regional, enterprise, or reverse-proxy URL.
      baseUrl: "https://gateway.test/openai/v1",
      apiKey: "sk-openai-test"
    }).streamChat(
      {
        model: "gpt-5.6",
        messages: [
          {
            role: "user",
            content: "What is shown?",
            images: [
              {
                imageId: "vision-fixture",
                fileName: "fixture.png",
                mimeType: "image/png",
                size: 5,
                base64: "aW1hZ2U="
              }
            ]
          }
        ],
        num_predict: 256,
        tools: [weatherTool]
      },
      collected.onChunk
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.test/openai/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(request.headers).toMatchObject({
      Authorization: "Bearer sk-openai-test"
    })
    expect(requestBody(fetchMock)).toMatchObject({
      model: "gpt-5.6",
      max_completion_tokens: 256,
      stream_options: { include_usage: true },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is shown?" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aW1hZ2U=" }
            }
          ]
        }
      ]
    })
    expect(requestBody(fetchMock).max_tokens).toBeUndefined()
    expect(collected.chunks.at(-1)).toMatchObject({
      done: true,
      metrics: expect.objectContaining({
        prompt_eval_count: 7,
        eval_count: 3
      })
    })
  })

  it("preserves OpenRouter attribution, prefixed model ids, and SSE comments", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        streamResponse([": OPENROUTER PROCESSING\n\n", ...openAIStream()])
      )
    const collected = collectChunks()

    await new OpenAICompatibleProvider({
      id: "custom:openai:openrouter",
      type: ProviderType.OPENAI,
      serviceProfile: ProviderServiceProfile.OPENROUTER,
      enabled: true,
      name: "OpenRouter",
      baseUrl: "https://gateway.test/openrouter/api/v1",
      apiKey: "sk-or-test"
    }).streamChat(
      {
        model: "anthropic/claude-sonnet-4.6",
        messages: [{ role: "user", content: "Weather?" }],
        tools: [weatherTool]
      },
      collected.onChunk
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.test/openrouter/api/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(request.headers).toMatchObject({
      Authorization: "Bearer sk-or-test",
      "HTTP-Referer": "https://www.ollamaclient.in",
      "X-OpenRouter-Title": "Ollama Client"
    })
    expect(requestBody(fetchMock)).toMatchObject({
      model: "anthropic/claude-sonnet-4.6",
      stream_options: { include_usage: true }
    })
    expect(collected.chunks).toContainEqual(
      expect.objectContaining({ thinkingDelta: "plan" })
    )
  })

  it("uses Anthropic's native Messages stream and tool blocks", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        streamResponse([
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7,"output_tokens":1}}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Checking"}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-1","name":"get_weather"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Paris\\"}"}}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        ])
      )
    const collected = collectChunks()

    await new AnthropicProvider({
      id: "custom:anthropic:anthropic",
      type: ProviderType.ANTHROPIC,
      serviceProfile: ProviderServiceProfile.ANTHROPIC,
      enabled: true,
      name: "Anthropic",
      baseUrl: "https://gateway.test/anthropic/v1",
      apiKey: "sk-ant-test"
    }).streamChat(
      {
        model: "claude-sonnet-4-6",
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "Weather?" }
        ],
        tools: [weatherTool]
      },
      collected.onChunk
    )

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.test/anthropic/v1/messages",
      expect.objectContaining({ method: "POST" })
    )
    expect(request.headers).toMatchObject({
      "x-api-key": "sk-ant-test",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    })
    expect(requestBody(fetchMock)).toMatchObject({
      model: "claude-sonnet-4-6",
      system: "Be concise.",
      stream: true,
      tools: [
        {
          name: "get_weather",
          input_schema: weatherTool.parameters
        }
      ]
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
})
