import { afterEach, describe, expect, it, vi } from "vitest"

import type { ToolDefinition } from "@/lib/tools/types"
import type { ChatStreamMessage } from "@/types"
import { AnthropicProvider } from "../anthropic"
import {
  type ProviderConfig,
  ProviderServiceProfile,
  ProviderType
} from "../types"

const encoder = new TextEncoder()
const config: ProviderConfig = {
  id: "custom:anthropic:test",
  type: ProviderType.ANTHROPIC,
  enabled: true,
  name: "Claude",
  baseUrl: "https://api.anthropic.com/v1",
  apiKey: "sk-ant-test"
}

const streamResponse = (chunks: string[]) => {
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: vi.fn(async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true, value: undefined }
        ),
        releaseLock: vi.fn()
      })
    },
    text: async () => ""
  } as unknown as Response
}

const weatherTool: ToolDefinition = {
  name: "weather",
  description: "Get weather",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } }
  }
}

afterEach(() => vi.restoreAllMocks())

describe("AnthropicProvider", () => {
  it("discovers models with native Anthropic headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "claude-sonnet", created_at: "2026-01-01T00:00:00Z" }]
        }),
        { status: 200 }
      )
    )

    const models = await new AnthropicProvider(config).getModels()

    expect(models.map((model) => model.name)).toEqual(["claude-sonnet"])
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "sk-ant-test",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        })
      })
    )
  })

  it("keeps generic Anthropic-compatible requests keyless", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      )
    const genericConfig: ProviderConfig = {
      ...config,
      id: "custom:anthropic:local",
      baseUrl: "http://localhost:8080/v1",
      apiKey: undefined,
      serviceProfile: ProviderServiceProfile.GENERIC
    }

    await new AnthropicProvider(genericConfig).getModels()

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >
    expect(headers["x-api-key"]).toBeUndefined()
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined()
    expect(headers["anthropic-version"]).toBe("2023-06-01")
  })

  it("maps system, tools, and tool results to native content blocks", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new AnthropicProvider(config).streamChat(
      {
        model: "claude-sonnet",
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "Weather?" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "tool-1",
                name: "weather",
                arguments: { city: "Paris" }
              }
            ]
          },
          {
            role: "tool",
            content: "18 C",
            toolName: "weather",
            toolCallId: "tool-1"
          },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "tool-2", name: "weather", arguments: { city: "Lyon" } }
            ]
          },
          {
            role: "tool",
            content: "The user declined this action, so it was not performed.",
            toolName: "weather",
            toolCallId: "tool-2",
            toolIsError: true
          }
        ],
        tools: [weatherTool],
        temperature: 1.8
      },
      () => {}
    )

    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string
    )
    expect(body.system).toBe("Be concise.")
    expect(body.temperature).toBe(1)
    expect(body.tools).toEqual([
      {
        name: "weather",
        description: "Get weather",
        input_schema: weatherTool.parameters
      }
    ])
    expect(body.messages[1].content).toEqual([
      {
        type: "tool_use",
        id: "tool-1",
        name: "weather",
        input: { city: "Paris" }
      }
    ])
    expect(body.messages[2].content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tool-1",
        content: "18 C",
        is_error: false
      }
    ])
    // Denied/failed results must carry the native error flag so the model
    // doesn't read the failure text as a successful tool run.
    expect(body.messages[4].content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tool-2",
        content: "The user declined this action, so it was not performed.",
        is_error: true
      }
    ])
  })

  it("parses text and streamed tool input", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Checking"}}\n',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"weather"}}\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Paris\\"}"}}\n',
        'data: {"type":"message_delta","usage":{"output_tokens":8}}\n',
        'data: {"type":"message_stop"}\n'
      ])
    )
    const chunks: ChatStreamMessage[] = []

    await new AnthropicProvider(config).streamChat(
      {
        model: "claude-sonnet",
        messages: [{ role: "user", content: "Weather?" }],
        tools: [weatherTool]
      },
      (chunk) => chunks.push(chunk)
    )

    expect(chunks.some((chunk) => chunk.delta === "Checking")).toBe(true)
    expect(chunks.find((chunk) => chunk.toolCalls)?.toolCalls).toEqual([
      {
        id: "tool-1",
        name: "weather",
        arguments: { city: "Paris" }
      }
    ])
    expect(chunks.at(-1)).toMatchObject({
      done: true,
      metrics: { prompt_eval_count: 10, eval_count: 8 }
    })
  })

  it("enables extended thinking for tool-free requests and drops sampling overrides", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new AnthropicProvider(config).streamChat(
      {
        model: "claude-sonnet",
        messages: [{ role: "user", content: "Think hard." }],
        think: true,
        temperature: 0.4,
        top_p: 0.9,
        num_predict: 1000
      },
      () => {}
    )

    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string
    )
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 })
    // max_tokens must exceed the thinking budget even when num_predict is small
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens)
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
  })

  it("keeps thinking off when tools are present (no signed blocks to replay)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new AnthropicProvider(config).streamChat(
      {
        model: "claude-sonnet",
        messages: [{ role: "user", content: "Weather?" }],
        tools: [weatherTool],
        think: true,
        temperature: 0.4
      },
      () => {}
    )

    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string
    )
    expect(body.thinking).toBeUndefined()
    expect(body.temperature).toBe(0.4)
  })

  it("keeps thinking off during tool-loop synthesis (tool_choice none but tool history present)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new AnthropicProvider(config).streamChat(
      {
        model: "claude-sonnet",
        messages: [
          { role: "user", content: "Weather?" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "tool-1", name: "weather", arguments: { city: "Paris" } }
            ]
          },
          {
            role: "tool",
            content: "18 C",
            toolName: "weather",
            toolCallId: "tool-1"
          }
        ],
        // Final synthesis turn: tools suppressed, but the signed thinking blocks
        // for the earlier tool_use turn were never persisted.
        tool_choice: "none",
        think: true
      },
      () => {}
    )

    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string
    )
    expect(body.thinking).toBeUndefined()
  })

  it("collapses the unlimited num_predict sentinel to a positive max_tokens", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamResponse([]))

    await new AnthropicProvider(config).streamChat(
      {
        model: "claude-sonnet",
        messages: [{ role: "user", content: "Think hard." }],
        think: true,
        num_predict: -1
      },
      () => {}
    )

    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string
    )
    // -1 must never reach the API; thinking budget derives from the default cap.
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens)
    expect(body.thinking.budget_tokens).toBe(2048)
  })
})
