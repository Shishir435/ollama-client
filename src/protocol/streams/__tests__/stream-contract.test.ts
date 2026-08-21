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
        },
        thinkingState: { inThinking: true, pending: "</thi" }
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

  it("carries activity label keys across the context stream", () => {
    const parsed = parseChatStreamServerEvent({
      version: 1,
      type: "context_progress",
      requestId: "turn-1",
      events: [
        {
          id: "memory-recall",
          kind: "searching_memory",
          label: "Searching memory",
          labelKey: "chat.reasoning.trace.searching_memory",
          status: "running",
          startedAt: 1
        }
      ]
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    // The stream keeps its own copy of this schema; a missed field here would
    // strip the key before the sidepanel ever sees it.
    expect(parsed.data).toMatchObject({
      type: "context_progress",
      events: [{ labelKey: "chat.reasoning.trace.searching_memory" }]
    })
  })

  it("carries app-generated chunk title keys in the context result", () => {
    const parsed = parseChatStreamServerEvent({
      version: 1,
      type: "context_result",
      requestId: "turn-1",
      result: {
        contentWithRAG: "question\n\n<page>body</page>",
        ragSources: null,
        promptContextStats: {
          promptInputLength: 8,
          promptAugmentedLength: 30,
          tabContextLength: 22,
          ragContextLength: 0,
          tabContextTruncated: false,
          groundedOnlyMode: false,
          insufficientContext: false,
          usedContextChunks: [
            {
              id: "tab-fallback",
              title: "Selected tab context",
              titleKey: "chat.sources.tab_context",
              excerpt: "body",
              score: 0.5,
              source: "tab"
            }
          ],
          activityEvents: []
        },
        pageContextAdded: false
      },
      receipt: {
        version: 1,
        turnId: "turn-1",
        mode: "new",
        createdAt: 1,
        query: "question",
        model: { id: "qwen3" },
        prompt: {
          inputLength: 8,
          augmentedLength: 30,
          tabContextLength: 22,
          ragContextLength: 0,
          tabContextTruncated: false,
          groundedOnlyMode: false,
          insufficientContext: false
        },
        sources: []
      }
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toMatchObject({
      type: "context_result",
      result: {
        promptContextStats: {
          usedContextChunks: [{ titleKey: "chat.sources.tab_context" }]
        }
      }
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

  it("carries provider-generated images in ordinary chat chunks", () => {
    const parsed = parseChatStreamServerEvent({
      version: 1,
      type: "chat_chunk",
      seq: 0,
      generatedImages: [
        {
          imageId: "generated-1",
          fileName: "generated-image-1.png",
          mimeType: "image/png",
          size: 8,
          base64: "iVBORw0K",
          origin: "model-generated",
          generatedBy: { providerId: "custom", model: "image-model" }
        }
      ],
      done: true
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toMatchObject({
      generatedImages: [
        {
          origin: "model-generated",
          generatedBy: { providerId: "custom", model: "image-model" }
        }
      ]
    })
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
