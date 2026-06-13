import { describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/providers/types"
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
  run: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ content: string; isError?: boolean }>
) => {
  const reg = new ToolRegistry()
  reg.register({
    id: "test",
    listTools: () => [
      {
        name: "echo",
        description: "",
        parameters: { type: "object", properties: {} }
      }
    ],
    callTool: (name, args) => run(name, args)
  })
  return reg
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

    expect(provider.streamChat).toHaveBeenCalledTimes(3)
    expect(chunks.filter((c) => c.done)).toHaveLength(1)
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
