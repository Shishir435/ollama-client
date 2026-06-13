import { afterEach, describe, expect, it, vi } from "vitest"

import type { ToolDefinition } from "@/lib/tools/types"
import type { ChatStreamMessage } from "@/types"
import { OllamaProvider } from "../ollama"
import { OpenAICompatibleProvider } from "../openai-compatible"
import { type ChatRequest, type ProviderConfig, ProviderType } from "../types"

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
      { type: "function", function: weatherTool }
    ])
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
    expect(body.tools).toEqual([{ type: "function", function: weatherTool }])
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
})
