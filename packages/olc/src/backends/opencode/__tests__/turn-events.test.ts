import { describe, expect, it, vi } from "vitest"
import { createTurnReader, extractFromParts } from "../turn-events.js"

const retryAsync = async <T>(operation: () => Promise<T>): Promise<T> =>
  operation()

const clientWith = ({
  diffs = [],
  events = [],
  messages = []
}: {
  diffs?: unknown
  events?: unknown[]
  messages?: unknown
} = {}) => ({
  event: {
    subscribe: vi.fn(async () => ({
      stream: (async function* () {
        for (const event of events) yield event
      })()
    }))
  },
  session: {
    diff: vi.fn(async () => diffs),
    messages: vi.fn(async () => messages)
  }
})

describe("extractFromParts", () => {
  it("returns empty output for a non-array payload", () => {
    expect(extractFromParts(null)).toEqual({
      content: "",
      reasoning: "",
      toolErrors: []
    })
  })

  it("joins text and reasoning while summarizing failed tools", () => {
    expect(
      extractFromParts([
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
        { type: "reasoning", text: "thinking" },
        {
          type: "tool",
          tool: "search",
          state: { status: "error", error: "denied" }
        },
        {
          type: "tool",
          name: "write",
          state: { status: "failed", output: "disk full" }
        },
        { type: "tool", state: { status: "completed" } }
      ])
    ).toEqual({
      content: "hello world",
      reasoning: "thinking",
      toolErrors: [
        { tool: "search", error: "denied" },
        { tool: "write", error: "disk full" }
      ]
    })
  })
})

describe("OpenCode turn reader", () => {
  it("normalizes wrapped, direct, and invalid session diffs", async () => {
    const wrapped = clientWith({ diffs: { data: [{ file: "a.ts" }] } })
    const direct = clientWith({ diffs: [{ file: "b.ts" }] })
    const invalid = clientWith({ diffs: { data: { file: "c.ts" } } })

    await expect(
      createTurnReader({
        client: wrapped as never,
        retryAsync
      }).getSessionDiffs("s1", "m1")
    ).resolves.toEqual([{ file: "a.ts" }])
    await expect(
      createTurnReader({ client: direct as never, retryAsync }).getSessionDiffs(
        "s2"
      )
    ).resolves.toEqual([{ file: "b.ts" }])
    await expect(
      createTurnReader({
        client: invalid as never,
        retryAsync
      }).getSessionDiffs("s3")
    ).resolves.toEqual([])
    expect(wrapped.session.diff).toHaveBeenCalledWith({
      path: { id: "s1" },
      query: { messageID: "m1" }
    })
  })

  it("streams classified text and reasoning until a terminal event", async () => {
    const client = clientWith({
      events: [
        {
          type: "message.part.updated",
          properties: {
            part: { sessionID: "session-1", id: "text-1", type: "text" },
            delta: "hello"
          }
        },
        {
          type: "message.part.updated",
          properties: {
            part: {
              sessionID: "session-1",
              id: "reason-1",
              type: "reasoning"
            },
            delta: "think"
          }
        },
        {
          type: "message.updated",
          properties: { info: { sessionID: "session-1", finish: "stop" } }
        }
      ]
    })
    const onDelta = vi.fn()
    const reader = createTurnReader({ client: client as never, retryAsync })

    const stream = await reader.openEventStream("session-1", {
      timeoutMs: 1000,
      onDelta
    })

    await expect(stream.done).resolves.toEqual({
      content: "hello",
      reasoning: "think",
      finish: "stop"
    })
    expect(onDelta.mock.calls).toEqual([
      ["hello", false],
      ["think", true]
    ])
    expect(stream.controller.signal.aborted).toBe(true)
  })

  it("announces each patch hash once with its session diff", async () => {
    const patch = {
      sessionID: "session-1",
      id: "patch-1",
      messageID: "message-1",
      type: "patch",
      hash: "hash-1",
      files: ["a.ts"]
    }
    const client = clientWith({
      diffs: { data: [{ path: "a.ts" }] },
      events: [
        { type: "message.part.updated", properties: { part: patch } },
        { type: "message.part.updated", properties: { part: patch } },
        {
          type: "message.updated",
          properties: { info: { sessionID: "session-1", finish: "stop" } }
        }
      ]
    })
    const onPatch = vi.fn()
    const reader = createTurnReader({ client: client as never, retryAsync })

    const { done } = await reader.openEventStream("session-1", {
      timeoutMs: 1000,
      onPatch
    })
    await done

    expect(onPatch).toHaveBeenCalledOnce()
    expect(onPatch).toHaveBeenCalledWith({
      hash: "hash-1",
      files: ["a.ts"],
      diffs: [{ path: "a.ts" }]
    })
  })

  it("polls the latest assistant, emits progress, patches, and tool errors", async () => {
    const client = clientWith({
      diffs: [{ path: "changed.ts" }],
      messages: {
        data: [
          { info: { role: "user" }, parts: [{ type: "text", text: "q" }] },
          {
            info: { role: "assistant", finish: "stop" },
            parts: [
              { type: "text", text: "answer" },
              { type: "reasoning", text: "thought" },
              {
                type: "tool",
                tool: "search",
                state: { status: "error", error: "failed" }
              },
              {
                id: "patch-1",
                type: "patch",
                hash: "hash-1",
                files: ["changed.ts"]
              }
            ]
          }
        ]
      }
    })
    const onProgress = vi.fn()
    const onPatch = vi.fn()
    const reader = createTurnReader({
      client: client as never,
      retryAsync,
      pollIntervalMs: 0
    })

    await expect(
      reader.pollForAssistantResponse("session-1", {
        timeoutMs: 1000,
        requireFinalOrContent: true,
        onProgress,
        onPatch
      })
    ).resolves.toMatchObject({
      content: "answer",
      reasoning: "thought",
      finish: "stop",
      toolErrors: [{ tool: "search", error: "failed" }]
    })
    expect(onProgress).toHaveBeenCalledWith("answer", "thought")
    expect(onPatch).toHaveBeenCalledWith({
      hash: "hash-1",
      files: ["changed.ts"],
      diffs: [{ path: "changed.ts" }]
    })
  })

  it("returns immediately when polling observes suspension", async () => {
    const client = clientWith()
    const reader = createTurnReader({ client: client as never, retryAsync })

    await expect(
      reader.pollForAssistantResponse("session-1", {
        timeoutMs: 1000,
        isSuspended: () => true
      })
    ).resolves.toEqual({
      content: "",
      reasoning: "",
      toolErrors: [],
      suspended: true
    })
    expect(client.session.messages).not.toHaveBeenCalled()
  })

  it("retries only polling timeouts", async () => {
    const client = clientWith({ messages: [] })
    const reader = createTurnReader({
      client: client as never,
      retryAsync,
      pollIntervalMs: 0
    })

    await expect(
      reader.pollForAssistantResponseWithRetries(
        "session-1",
        { timeoutMs: 1, intervalMs: 0 },
        1
      )
    ).rejects.toThrow("Request timeout")
    expect(client.session.messages.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
