import { describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/providers/types"
import type { ToolDefinition, ToolResult } from "@/lib/tools"
import { ToolRegistry } from "@/lib/tools"
import type { ChatStreamMessage } from "@/types"
import { streamChatWithNonNativeTools } from "../stream-chat-with-non-native-tools"

const scriptedProvider = (scripts: ChatStreamMessage[][]): LLMProvider => {
  let call = 0
  return {
    id: "test",
    config: {} as LLMProvider["config"],
    capabilities: {} as LLMProvider["capabilities"],
    streamChat: vi.fn(async (_req, onChunk) => {
      for (const chunk of scripts[call] ?? [{ done: true }]) onChunk(chunk)
      call++
    }),
    getModels: async () => []
  }
}

const echoDef: ToolDefinition = {
  name: "echo",
  description: "echoes",
  parameters: { type: "object", properties: {} }
}

const registryWith = (
  run: (name: string, args: Record<string, unknown>) => Promise<ToolResult>,
  definitions: ToolDefinition[] = [echoDef]
) => {
  const reg = new ToolRegistry()
  reg.register({
    id: "test",
    listTools: () => definitions,
    callTool: (name, args) => run(name, args)
  })
  return reg
}

const deltasOf = (chunks: ChatStreamMessage[]) =>
  chunks
    .map((c) => c.delta)
    .filter((d): d is string => typeof d === "string")
    .join("")

describe("streamChatWithNonNativeTools", () => {
  it("parses a <tool_call> turn, runs the tool, and finalizes the answer", async () => {
    const provider = scriptedProvider([
      [
        {
          delta:
            'Let me look.\n<tool_call>{"name":"echo","arguments":{"x":1}}</tool_call>'
        },
        { done: true }
      ],
      [{ delta: "final answer" }, { done: true }]
    ])
    const registry = registryWith(async (_n, args) => ({
      content: `ran:${JSON.stringify(args)}`
    }))

    const chunks: ChatStreamMessage[] = []
    await streamChatWithNonNativeTools({
      provider,
      request: { model: "m", messages: [{ role: "user", content: "hi" }] },
      tools: [echoDef],
      registry,
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })

    expect(provider.streamChat).toHaveBeenCalledTimes(2)
    // The prose prefix is shown; the <tool_call> markup is NOT.
    const visible = deltasOf(chunks)
    expect(visible).toContain("Let me look.")
    expect(visible).not.toContain("<tool_call>")
    expect(visible).toContain("final answer")
    // Exactly one terminal done.
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
    // Trace shows the tool run as done.
    const lastTrace = [...chunks].reverse().find((c) => c.toolRuns)?.toolRuns
    expect(lastTrace?.[0]).toMatchObject({ toolId: "echo", status: "done" })
  })

  it("never sends a tools array to the provider", async () => {
    const provider = scriptedProvider([[{ delta: "hi" }, { done: true }]])
    await streamChatWithNonNativeTools({
      provider,
      request: {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        tools: [echoDef]
      },
      tools: [echoDef],
      registry: registryWith(async () => ({ content: "x" })),
      onChunk: () => {},
      ctx: {}
    })
    const firstArg = vi.mocked(provider.streamChat).mock.calls[0]?.[0]
    expect(firstArg?.tools).toBeUndefined()
  })

  it("injects the tool prompt into the system message", async () => {
    const provider = scriptedProvider([[{ delta: "answer" }, { done: true }]])
    await streamChatWithNonNativeTools({
      provider,
      request: {
        model: "m",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "hi" }
        ]
      },
      tools: [echoDef],
      registry: registryWith(async () => ({ content: "x" })),
      onChunk: () => {},
      ctx: {}
    })
    const sentMessages = vi.mocked(provider.streamChat).mock.calls[0]?.[0]
      .messages
    const system = sentMessages?.find((m) => m.role === "system")
    expect(system?.content).toContain("You are helpful.")
    expect(system?.content).toContain("<tool_call>")
  })

  it("answers directly when the model emits no tool call", async () => {
    const provider = scriptedProvider([
      [{ delta: "direct answer" }, { done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithNonNativeTools({
      provider,
      request: { model: "m", messages: [{ role: "user", content: "hi" }] },
      tools: [echoDef],
      registry: registryWith(async () => ({ content: "unused" })),
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })
    expect(provider.streamChat).toHaveBeenCalledTimes(1)
    expect(deltasOf(chunks)).toBe("direct answer")
  })

  it("hits the iteration cap and still produces a final answer", async () => {
    // Every turn emits a tool call → loop never converges → cap → synthesis.
    const toolTurn: ChatStreamMessage[] = [
      { delta: '<tool_call>{"name":"echo","arguments":{}}</tool_call>' },
      { done: true }
    ]
    const provider = scriptedProvider([
      toolTurn,
      toolTurn,
      [{ delta: "capped synthesis" }, { done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithNonNativeTools({
      provider,
      request: { model: "m", messages: [{ role: "user", content: "hi" }] },
      tools: [echoDef],
      registry: registryWith(async () => ({ content: "r" })),
      onChunk: (c) => chunks.push(c),
      ctx: {},
      maxIterations: 2
    })
    // 2 tool iterations + 1 synthesis pass.
    expect(provider.streamChat).toHaveBeenCalledTimes(3)
    expect(deltasOf(chunks)).toContain("capped synthesis")
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
  })

  it("assigns unique callIds across turns and separate invocations", async () => {
    const toolTurn = (): ChatStreamMessage[] => [
      { delta: '<tool_call>{"name":"echo","arguments":{}}</tool_call>' },
      { done: true }
    ]
    const runOnce = async () => {
      const provider = scriptedProvider([
        toolTurn(),
        toolTurn(),
        [{ delta: "done" }, { done: true }]
      ])
      const chunks: ChatStreamMessage[] = []
      await streamChatWithNonNativeTools({
        provider,
        request: { model: "m", messages: [{ role: "user", content: "hi" }] },
        tools: [echoDef],
        registry: registryWith(async () => ({ content: "r" })),
        onChunk: (c) => chunks.push(c),
        ctx: {}
      })
      const trace = [...chunks].reverse().find((c) => c.toolRuns)?.toolRuns
      return (trace ?? []).map((run) => run.callId)
    }

    // Two turns in one invocation, then a second invocation — the same tool at
    // parser index 0 each time. Repeats would collide in the confirmation
    // registry and silently suppress the UI prompt.
    const ids = [...(await runOnce()), ...(await runOnce())]
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
  })

  it("aborts immediately when the signal is already aborted", async () => {
    const provider = scriptedProvider([[{ delta: "x" }, { done: true }]])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithNonNativeTools({
      provider,
      request: { model: "m", messages: [{ role: "user", content: "hi" }] },
      tools: [echoDef],
      registry: registryWith(async () => ({ content: "x" })),
      onChunk: (c) => chunks.push(c),
      ctx: {},
      signal: AbortSignal.abort()
    })
    expect(provider.streamChat).not.toHaveBeenCalled()
    expect(chunks).toEqual([{ done: true, aborted: true }])
  })

  it("hides tool-call markup even when split across stream chunks", async () => {
    const provider = scriptedProvider([
      [
        { delta: "Text <to" },
        { delta: "ol_call>" },
        { delta: '{"name":"echo","arguments":{}}</tool_call>' },
        { done: true }
      ],
      [{ delta: "done" }, { done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithNonNativeTools({
      provider,
      request: { model: "m", messages: [{ role: "user", content: "hi" }] },
      tools: [echoDef],
      registry: registryWith(async () => ({ content: "r" })),
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })
    const visible = deltasOf(chunks)
    expect(visible).not.toContain("<tool_call>")
    expect(visible).not.toContain("<to")
    expect(visible).toContain("Text")
    expect(visible).toContain("done")
  })
})
