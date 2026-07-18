import { afterEach, describe, expect, it, vi } from "vitest"

import { isAppError } from "@/lib/error-utils"
import type { ToolDefinition } from "@/lib/tools/types"
import type { ChatStreamMessage } from "@/types"
import { OllamaProvider } from "../ollama"
import { OpenAICompatibleProvider } from "../openai-compatible"
import {
  type ChatRequest,
  type ProviderConfig,
  ProviderId,
  ProviderServiceProfile,
  ProviderType
} from "../types"

const encoder = new TextEncoder()

/** A fetch Response whose body streams the given string chunks then ends. */
const streamResponse = (chunks: string[]) => {
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: vi.fn(async () =>
          i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined }
        ),
        releaseLock: vi.fn()
      })
    },
    text: async () => ""
  } as unknown as Response
}

const bodyOf = (fetchMock: ReturnType<typeof vi.spyOn>) =>
  JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)

const collect = (chunks: ChatStreamMessage[]) => (c: ChatStreamMessage) =>
  chunks.push(c)

const weatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get weather",
  displayNameKey: "tool.weather",
  iconKey: "search",
  category: "external",
  risk: "low",
  runtime: { timeoutMs: 5000 },
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"]
  }
}

const ollamaConfig: ProviderConfig = {
  id: "ollama",
  type: ProviderType.OLLAMA,
  enabled: true,
  baseUrl: "http://localhost:11434",
  name: "Ollama"
}

const openaiConfig: ProviderConfig = {
  id: "x",
  type: ProviderType.OPENAI,
  enabled: true,
  baseUrl: "http://localhost:8000/v1",
  name: "X"
}

const baseRequest: ChatRequest = {
  model: "m",
  messages: [{ role: "user", content: "weather in Paris?" }],
  tools: [weatherTool]
}

describe("provider tool calling — request mapping", () => {
  afterEach(() => vi.restoreAllMocks())

  it("Ollama maps tools to OpenAI-style function entries", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new OllamaProvider(ollamaConfig).streamChat(baseRequest, () => {})

    expect(bodyOf(fetchMock).tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: weatherTool.parameters
        }
      }
    ])
    expect(bodyOf(fetchMock).tools[0].function.displayNameKey).toBeUndefined()
  })

  it("omits tools entirely when none are offered (unchanged wire shape)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new OllamaProvider(ollamaConfig).streamChat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      () => {}
    )

    expect(bodyOf(fetchMock).tools).toBeUndefined()
  })

  it("passes Ollama think=false for no-reasoning utility calls", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new OllamaProvider(ollamaConfig).streamChat(
      {
        model: "m",
        messages: [{ role: "user", content: "rewrite query" }],
        think: false,
        num_predict: 64
      },
      () => {}
    )

    expect(bodyOf(fetchMock)).toMatchObject({
      think: false,
      options: { num_predict: 64 }
    })
  })

  it("Ollama maps assistant tool calls and tool results back to the wire", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new OllamaProvider(ollamaConfig).streamChat(
      {
        model: "m",
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "c1", name: "get_weather", arguments: { city: "Paris" } }
            ]
          },
          {
            role: "tool",
            content: "18C",
            toolName: "get_weather",
            toolCallId: "c1"
          }
        ]
      },
      () => {}
    )

    const messages = bodyOf(fetchMock).messages
    expect(messages[1].tool_calls).toEqual([
      { function: { name: "get_weather", arguments: { city: "Paris" } } }
    ])
    expect(messages[2]).toMatchObject({
      role: "tool",
      tool_name: "get_weather",
      content: "18C"
    })
  })

  it("OpenAI maps tools, assistant tool calls (string args), and tool results", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new OpenAICompatibleProvider(openaiConfig).streamChat(
      {
        model: "m",
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "c1", name: "get_weather", arguments: { city: "Paris" } }
            ]
          },
          {
            role: "tool",
            content: "18C",
            toolName: "get_weather",
            toolCallId: "c1"
          }
        ],
        tools: [weatherTool]
      },
      () => {}
    )

    const body = bodyOf(fetchMock)
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: weatherTool.parameters
        }
      }
    ])
    expect(body.tools[0].function.displayNameKey).toBeUndefined()
    expect(body.messages[0].tool_calls[0]).toEqual({
      id: "c1",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"Paris"}' }
    })
    expect(body.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: "18C"
    })
  })

  it("maps num_predict to the configured OpenAI output-token field", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))
    const config: ProviderConfig = {
      ...openaiConfig,
      id: "custom:openai:tokens",
      compatibility: { maxTokensField: "max_completion_tokens" }
    }

    const provider = new OpenAICompatibleProvider(config)
    await provider.streamChat(
      { model: "m", messages: [], num_predict: 321 },
      () => {}
    )

    expect(provider.id).toBe("custom:openai:tokens")
    expect(bodyOf(fetchMock)).toMatchObject({ max_completion_tokens: 321 })
    expect(bodyOf(fetchMock).max_tokens).toBeUndefined()
  })

  it("applies the OpenRouter profile without leaking the current page", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))
    const provider = new OpenAICompatibleProvider({
      ...openaiConfig,
      id: "custom:openai:openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-test",
      serviceProfile: ProviderServiceProfile.OPENROUTER
    })

    await provider.streamChat(
      { model: "openai/gpt-test", messages: [], num_predict: 64 },
      () => {}
    )

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(request.headers).toMatchObject({
      Authorization: "Bearer sk-or-test",
      "HTTP-Referer": "https://www.ollamaclient.in",
      "X-OpenRouter-Title": "Ollama Client"
    })
    expect(JSON.stringify(request.headers)).not.toContain("chrome-extension://")
    expect(bodyOf(fetchMock)).toMatchObject({
      max_tokens: 64,
      stream_options: { include_usage: true }
    })
  })

  it("infers OpenAI usage and token defaults from its hosted endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new OpenAICompatibleProvider({
      ...openaiConfig,
      id: "custom:openai:openai",
      baseUrl: "https://api.openai.com/v1"
    }).streamChat(
      { model: "gpt-test", messages: [], num_predict: 48 },
      () => {}
    )

    expect(bodyOf(fetchMock)).toMatchObject({
      max_completion_tokens: 48,
      stream_options: { include_usage: true }
    })
    expect(bodyOf(fetchMock).max_tokens).toBeUndefined()
  })

  it("omits stream_options for generic compatible endpoints", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new OpenAICompatibleProvider(openaiConfig).streamChat(
      { model: "m", messages: [] },
      () => {}
    )

    expect(bodyOf(fetchMock).stream_options).toBeUndefined()
  })

  it("keeps usage streaming enabled for verified built-ins", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new OpenAICompatibleProvider({
      ...openaiConfig,
      id: ProviderId.LM_STUDIO
    }).streamChat({ model: "m", messages: [] }, () => {})

    expect(bodyOf(fetchMock).stream_options).toEqual({ include_usage: true })
  })
})

describe("provider tool calling — stream parsing", () => {
  afterEach(() => vi.restoreAllMocks())

  it("Ollama parses a whole tool_calls array (object args) into one chunk", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        `${JSON.stringify({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_x",
                function: {
                  index: 0,
                  name: "get_weather",
                  arguments: { city: "Paris" }
                }
              }
            ]
          },
          done: false
        })}\n`,
        `${JSON.stringify({ message: { content: "" }, done: true })}\n`
      ])
    )

    const chunks: ChatStreamMessage[] = []
    await new OllamaProvider(ollamaConfig).streamChat(
      baseRequest,
      collect(chunks)
    )

    const toolChunk = chunks.find((c) => c.toolCalls)
    expect(toolChunk?.toolCalls).toEqual([
      { id: "call_x", name: "get_weather", arguments: { city: "Paris" } }
    ])
  })

  it("OpenAI accumulates streamed tool_call fragments into one normalized call", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"get_weather","arguments":"{\\"ci"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\\":\\"Paris\\"}"}}]}}]}\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
        "data: [DONE]\n"
      ])
    )

    const chunks: ChatStreamMessage[] = []
    await new OpenAICompatibleProvider(openaiConfig).streamChat(
      baseRequest,
      collect(chunks)
    )

    const toolChunk = chunks.find((c) => c.toolCalls)
    expect(toolChunk?.toolCalls).toEqual([
      { id: "c1", name: "get_weather", arguments: { city: "Paris" } }
    ])
  })

  it("preserves fragmented OpenRouter reasoning details across a tool turn", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        streamResponse([
          'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"plan ","signature":null,"id":"r1","format":"anthropic-claude-v1","index":0}]}}]}\n',
          'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"continued","signature":"opaque-sig","id":"r1","format":"anthropic-claude-v1","index":0}]}}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Paris\\"}"}}]},"finish_reason":"tool_calls"}]}\n'
        ])
      )
      .mockResolvedValueOnce(streamResponse([]))
    const config: ProviderConfig = {
      ...openaiConfig,
      id: "custom:openai:openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      serviceProfile: ProviderServiceProfile.OPENROUTER
    }
    const provider = new OpenAICompatibleProvider(config)
    const chunks: ChatStreamMessage[] = []

    await provider.streamChat(baseRequest, collect(chunks))

    const toolChunk = chunks.find((chunk) => chunk.toolCalls)
    expect(toolChunk?.replayArtifact?.blocks).toEqual([
      {
        type: "reasoning.text",
        text: "plan ",
        signature: null,
        id: "r1",
        format: "anthropic-claude-v1",
        index: 0
      },
      {
        type: "reasoning.text",
        text: "continued",
        signature: "opaque-sig",
        id: "r1",
        format: "anthropic-claude-v1",
        index: 0
      }
    ])

    await provider.streamChat(
      {
        ...baseRequest,
        messages: [
          ...baseRequest.messages,
          {
            role: "assistant",
            content: "",
            toolCalls: toolChunk?.toolCalls,
            replayArtifact: toolChunk?.replayArtifact
          },
          {
            role: "tool",
            content: "18 C",
            toolName: "get_weather",
            toolCallId: "call-1"
          }
        ]
      },
      () => {}
    )

    const secondBody = JSON.parse(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).body as string
    )
    expect(secondBody.messages[1].reasoning_details).toEqual(
      toolChunk?.replayArtifact?.blocks
    )
  })

  it("ignores OpenRouter keep-alive comments and surfaces in-band errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        ": OPENROUTER PROCESSING\n",
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n',
        'data: {"error":{"code":429,"message":"upstream rate limit","metadata":{"headers":{"Retry-After":"7"}}}}\n'
      ])
    )
    const chunks: ChatStreamMessage[] = []

    try {
      await new OpenAICompatibleProvider(openaiConfig).streamChat(
        baseRequest,
        collect(chunks)
      )
      throw new Error("Expected streamChat to fail")
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) {
        expect(error.message).toContain("upstream rate limit")
        expect(error.status).toBe(429)
        expect(error.retryable).toBe(true)
        expect(error.retryAfterMs).toBe(7000)
        expect(error.userMessage).toContain("7 seconds")
      }
    }
    expect(chunks).toContainEqual({ delta: "partial", done: false })
  })

  it("Ollama surfaces provider stream errors instead of swallowing them as parse warnings", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([`${JSON.stringify({ error: "model crashed" })}\n`])
    )

    await expect(
      new OllamaProvider(ollamaConfig).streamChat(baseRequest, () => {})
    ).rejects.toThrow("model crashed")
  })
})
