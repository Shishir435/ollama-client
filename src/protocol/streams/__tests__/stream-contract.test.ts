import { describe, expect, it } from "vitest"
import { MESSAGE_KEYS } from "@/lib/constants"
import {
  ChatStreamClientEventSchema,
  ChatStreamServerEventSchema,
  parseChatStreamServerEvent
} from "@/protocol/streams"

describe("stream protocol", () => {
  it("defines cancellation and reconnect as versioned client commands", () => {
    expect(
      ChatStreamClientEventSchema.safeParse({
        version: 1,
        type: MESSAGE_KEYS.PROVIDER.STOP_GENERATION,
        payload: { requestId: "turn-1" }
      }).success
    ).toBe(true)
    expect(
      ChatStreamClientEventSchema.safeParse({
        version: 1,
        type: MESSAGE_KEYS.PROVIDER.RECONNECT_STREAM,
        payload: { requestId: "turn-1", afterSeq: 4 }
      }).success
    ).toBe(true)
  })

  it("defines a durable snapshot with the last accepted sequence", () => {
    expect(
      ChatStreamServerEventSchema.safeParse({
        version: 1,
        type: "stream_snapshot",
        requestId: "turn-1",
        seq: 4,
        sequenceReset: false,
        status: "generating",
        assistant: {
          role: "assistant",
          content: "partial",
          done: false
        }
      }).success
    ).toBe(true)
  })

  it("preserves approval state in tool-run events", () => {
    const parsed = parseChatStreamServerEvent({
      version: 1,
      type: "chat_chunk",
      seq: 3,
      toolRuns: [
        {
          toolId: "delete_item",
          label: "Delete item",
          risk: "critical",
          taintGeneration: 2,
          origin: "https://example.com",
          status: "awaiting-confirmation",
          callId: "call-7",
          startedAt: 123
        }
      ]
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toMatchObject({
      type: "chat_chunk",
      toolRuns: [
        {
          risk: "critical",
          taintGeneration: 2,
          origin: "https://example.com",
          callId: "call-7"
        }
      ]
    })
  })

  it("rejects unknown versions and malformed events", () => {
    expect(
      ChatStreamServerEventSchema.safeParse({
        version: 2,
        type: "chat_chunk",
        seq: 0,
        delta: "no"
      }).success
    ).toBe(false)
    expect(
      ChatStreamServerEventSchema.safeParse({
        version: 1,
        type: "chat_chunk",
        seq: 0
      }).success
    ).toBe(false)
  })

  it("normalizes one legacy boundary event into v1", () => {
    const parsed = parseChatStreamServerEvent({ seq: 2, delta: "hello" })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toMatchObject({
      version: 1,
      type: "chat_chunk",
      seq: 2,
      delta: "hello"
    })
  })
})
