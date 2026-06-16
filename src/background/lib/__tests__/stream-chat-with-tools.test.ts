import { describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/providers/types"
import type { ToolDefinition, ToolResult } from "@/lib/tools"
import { ToolRegistry } from "@/lib/tools"
import type { ChatStreamMessage } from "@/types"
import { streamChatWithTools } from "../stream-chat-with-tools"

/** Build a provider whose streamChat replays a scripted chunk list per call. */
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

const registryWith = (
  run: (name: string, args: Record<string, unknown>) => Promise<ToolResult>,
  definition: ToolDefinition = {
    name: "echo",
    description: "",
    parameters: { type: "object", properties: {} }
  }
) => {
  const reg = new ToolRegistry()
  reg.register({
    id: "test",
    listTools: () => [definition],
    callTool: (name, args) => run(name, args)
  })
  return reg
}

const registryWithTools = (
  definitions: ToolDefinition[],
  run: (name: string, args: Record<string, unknown>) => Promise<ToolResult>
) => {
  const reg = new ToolRegistry()
  reg.register({
    id: "test",
    listTools: () => definitions,
    callTool: (name, args) => run(name, args)
  })
  return reg
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe("streamChatWithTools", () => {
  it("runs a tool, re-streams, and finalizes with the answer + trace", async () => {
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c1", name: "echo", arguments: { x: 1 } }] },
        { done: true }
      ],
      [{ delta: "final answer" }, { done: true }]
    ])
    const registry = registryWith(async (_n, args) => ({
      content: `ran:${JSON.stringify(args)}`
    }))

    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [{ role: "user", content: "hi" }] },
      registry,
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })

    // Provider invoked twice (tool turn, then answer turn).
    expect(provider.streamChat).toHaveBeenCalledTimes(2)
    // Visible answer forwarded.
    expect(chunks.find((c) => c.delta)?.delta).toBe("final answer")
    // Exactly one terminal done.
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
    // Trace shows the tool run as done.
    const lastTrace = [...chunks].reverse().find((c) => c.toolRuns)?.toolRuns
    expect(lastTrace?.[0]).toMatchObject({ toolId: "echo", status: "done" })
  })

  it("preserves metrics when a bare done trails the metrics-bearing done", async () => {
    // Providers emit a metrics done then a trailing bare { done: true } at
    // stream end; the bare one must not wipe the captured metrics.
    const provider = scriptedProvider([
      [
        { delta: "answer" },
        {
          done: true,
          metrics: { eval_count: 10, eval_duration: 1_000_000_000 }
        },
        { done: true }
      ]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: "r" })),
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })
    const done = chunks.find((c) => c.done)
    expect(done?.metrics?.eval_count).toBe(10)
  })

  it("trims an oversized tool result and flags it in the trace", async () => {
    const big = "x".repeat(5000)
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c1", name: "echo", arguments: {} }] },
        { done: true }
      ],
      [{ delta: "ok" }, { done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: big })),
      onChunk: (c) => chunks.push(c),
      ctx: {},
      toolResultMaxChars: 1000
    })
    const trace = [...chunks].reverse().find((c) => c.toolRuns)?.toolRuns
    expect(trace?.[0]?.truncated).toBe(true)
  })

  it("uses per-tool result caps and carries display metadata into the trace", async () => {
    const big = "x".repeat(5000)
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c1", name: "echo", arguments: {} }] },
        { done: true }
      ],
      [{ delta: "ok" }, { done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: big }), {
        name: "echo",
        description: "",
        parameters: { type: "object", properties: {} },
        displayNameKey: "tool.echo",
        iconKey: "search",
        category: "knowledge",
        risk: "low",
        runtime: { maxResultChars: 100 }
      }),
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })

    const trace = [...chunks].reverse().find((c) => c.toolRuns)?.toolRuns
    expect(trace?.[0]).toMatchObject({
      truncated: true,
      displayNameKey: "tool.echo",
      iconKey: "search",
      category: "knowledge",
      risk: "low"
    })
  })

  it("prefixes source ids with the originating tool call id", async () => {
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c1", name: "echo", arguments: {} }] },
        { done: true }
      ],
      [{ delta: "ok" }, { done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({
        content: "tool result",
        sources: [{ id: "web-0", title: "Result", url: "https://a.com" }]
      })),
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })

    const trace = [...chunks].reverse().find((c) => c.toolRuns)?.toolRuns
    expect(trace?.[0]?.sources?.[0]?.id).toBe("c1:web-0")
  })

  it("lets the caller result cap override a per-tool cap", async () => {
    const big = "x".repeat(500)
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c1", name: "echo", arguments: {} }] },
        { done: true }
      ],
      [{ delta: "ok" }, { done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: big }), {
        name: "echo",
        description: "",
        parameters: { type: "object", properties: {} },
        runtime: { maxResultChars: 100 }
      }),
      onChunk: (c) => chunks.push(c),
      ctx: {},
      toolResultMaxChars: 1000
    })

    const trace = [...chunks].reverse().find((c) => c.toolRuns)?.toolRuns
    expect(trace?.[0]?.truncated).toBeUndefined()
  })

  it("does not flag a result that fits within the cap", async () => {
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c1", name: "echo", arguments: {} }] },
        { done: true }
      ],
      [{ delta: "ok" }, { done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: "short" })),
      onChunk: (c) => chunks.push(c),
      ctx: {},
      toolResultMaxChars: 1000
    })
    const trace = [...chunks].reverse().find((c) => c.toolRuns)?.toolRuns
    expect(trace?.[0]?.truncated).toBeUndefined()
  })

  it("suppresses intermediate done chunks (only one reaches the UI)", async () => {
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c1", name: "echo", arguments: {} }] },
        { done: true }
      ],
      [{ delta: "ok" }, { done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: "r" })),
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
  })

  it("a failed tool surfaces as an error run and does not crash the stream", async () => {
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c1", name: "echo", arguments: {} }] },
        { done: true }
      ],
      [{ delta: "recovered" }, { done: true }]
    ])
    const registry = registryWith(async () => ({
      content: "tool blew up",
      isError: true
    }))

    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry,
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })

    const trace = [...chunks].reverse().find((c) => c.toolRuns)?.toolRuns
    expect(trace?.[0]).toMatchObject({ status: "error", error: "tool blew up" })
    expect(chunks.find((c) => c.delta)?.delta).toBe("recovered")
  })

  it("runs parallelizable tool calls concurrently and keeps message order", async () => {
    const provider = scriptedProvider([
      [
        {
          toolCalls: [
            { id: "one-call", name: "one", arguments: {} },
            { id: "two-call", name: "two", arguments: {} }
          ]
        },
        { done: true }
      ],
      [{ delta: "ok" }, { done: true }]
    ])
    const started: string[] = []
    const resolvers = new Map<string, (value: { content: string }) => void>()
    const registry = registryWithTools(
      [
        {
          name: "one",
          description: "",
          parameters: { type: "object", properties: {} }
        },
        {
          name: "two",
          description: "",
          parameters: { type: "object", properties: {} }
        }
      ],
      (name) =>
        new Promise((resolve) => {
          started.push(name)
          resolvers.set(name, resolve)
        })
    )

    const chunks: ChatStreamMessage[] = []
    const promise = streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry,
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })

    await flushMicrotasks()
    expect(started).toEqual(["one", "two"])

    resolvers.get("two")?.({ content: "two result" })
    resolvers.get("one")?.({ content: "one result" })
    await promise

    const secondRequest = vi.mocked(provider.streamChat).mock.calls[1][0]
    expect(secondRequest.messages.slice(-2)).toEqual([
      {
        role: "tool",
        content: "one result",
        toolName: "one",
        toolCallId: "one-call"
      },
      {
        role: "tool",
        content: "two result",
        toolName: "two",
        toolCallId: "two-call"
      }
    ])
  })

  it("runs non-parallelizable tool calls before starting later calls", async () => {
    const provider = scriptedProvider([
      [
        {
          toolCalls: [
            { id: "serial-call", name: "serial", arguments: {} },
            { id: "fast-call", name: "fast", arguments: {} }
          ]
        },
        { done: true }
      ],
      [{ delta: "ok" }, { done: true }]
    ])
    const started: string[] = []
    let resolveSerial: ((value: { content: string }) => void) | undefined
    const registry = registryWithTools(
      [
        {
          name: "serial",
          description: "",
          parameters: { type: "object", properties: {} },
          runtime: { parallelizable: false }
        },
        {
          name: "fast",
          description: "",
          parameters: { type: "object", properties: {} }
        }
      ],
      (name) => {
        started.push(name)
        if (name === "serial") {
          return new Promise((resolve) => {
            resolveSerial = resolve
          })
        }
        return Promise.resolve({ content: "fast result" })
      }
    )

    const promise = streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry,
      onChunk: () => {},
      ctx: {}
    })

    await flushMicrotasks()
    expect(started).toEqual(["serial"])

    resolveSerial?.({ content: "serial result" })
    await promise
    expect(started).toEqual(["serial", "fast"])
  })

  it("stops promptly when aborted during a tool call", async () => {
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c1", name: "echo", arguments: {} }] },
        { done: true }
      ],
      [{ delta: "should not stream" }, { done: true }]
    ])
    const ac = new AbortController()
    const registry = registryWith(() => new Promise(() => {}))

    const chunks: ChatStreamMessage[] = []
    const promise = streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry,
      onChunk: (c) => chunks.push(c),
      ctx: { signal: ac.signal },
      signal: ac.signal
    })
    ac.abort()
    await promise

    expect(provider.streamChat).toHaveBeenCalledTimes(1)
    const trace = [...chunks].reverse().find((c) => c.toolRuns)?.toolRuns
    expect(trace?.[0]).toMatchObject({
      status: "error",
      error: 'Tool "echo" was stopped by the user.'
    })
    expect(chunks.at(-1)).toMatchObject({ done: true, aborted: true })
  })

  it("stops at the iteration cap if the model keeps calling tools", async () => {
    // Every turn requests a tool; the cap must end the loop.
    const provider = scriptedProvider(
      Array.from({ length: 10 }, () => [
        { toolCalls: [{ id: "c", name: "echo", arguments: {} }] },
        { done: true }
      ])
    )
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: "r" })),
      onChunk: (c) => chunks.push(c),
      ctx: {},
      maxIterations: 3
    })

    expect(provider.streamChat).toHaveBeenCalledTimes(4)
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
  })

  it("synthesizes a final answer when the iteration cap is hit", async () => {
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c", name: "echo", arguments: {} }] },
        { done: true }
      ],
      [{ delta: "answer from final synthesis" }, { done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: "tool result" })),
      onChunk: (c) => chunks.push(c),
      ctx: {},
      maxIterations: 1
    })

    expect(provider.streamChat).toHaveBeenCalledTimes(2)
    expect(chunks.find((c) => c.delta)?.delta).toBe(
      "answer from final synthesis"
    )
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
  })

  it("emits an explicit fallback if cap synthesis returns no text", async () => {
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c", name: "echo", arguments: {} }] },
        { done: true }
      ],
      [{ done: true }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: "tool result" })),
      onChunk: (c) => chunks.push(c),
      ctx: {},
      maxIterations: 1
    })

    expect(chunks.find((c) => c.delta)?.delta).toContain("tool-call limit")
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
  })

  it("keeps final metrics when the iteration cap stops the loop", async () => {
    const provider = scriptedProvider([
      [
        { toolCalls: [{ id: "c", name: "echo", arguments: {} }] },
        { done: true, metrics: { eval_count: 7 } }
      ]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: "r" })),
      onChunk: (c) => chunks.push(c),
      ctx: {},
      maxIterations: 1
    })

    expect(chunks.at(-1)).toMatchObject({
      done: true,
      metrics: { eval_count: 7 }
    })
  })

  it("forwards an error chunk and stops", async () => {
    const provider = scriptedProvider([
      [{ error: { status: 500, message: "boom" } }]
    ])
    const chunks: ChatStreamMessage[] = []
    await streamChatWithTools({
      provider,
      request: { model: "m", messages: [] },
      registry: registryWith(async () => ({ content: "r" })),
      onChunk: (c) => chunks.push(c),
      ctx: {}
    })

    expect(provider.streamChat).toHaveBeenCalledTimes(1)
    expect(chunks.find((c) => c.error)?.error?.message).toBe("boom")
  })
})
