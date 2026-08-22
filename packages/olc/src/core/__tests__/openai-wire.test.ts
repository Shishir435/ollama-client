import { describe, expect, it } from "vitest"
import type { PendingToolCall } from "../../types.js"
import {
  buildPromptParts,
  buildToolFlags,
  extractImageParts,
  extractTrailingToolResults,
  finishChunk,
  imageChunk,
  imageMimeFromUrl,
  normalizeMessageContent,
  toolCallsChunk
} from "../openai-wire.js"

const parked = (overrides: Partial<PendingToolCall> = {}): PendingToolCall => ({
  callId: "call_1",
  turnId: "ses_1",
  tool: "list_tabs",
  args: { limit: 5 },
  emitted: false,
  createdAt: 0,
  ...overrides
})

describe("normalizeMessageContent", () => {
  it("flattens the shapes OpenAI content arrives in", () => {
    expect(normalizeMessageContent("plain")).toBe("plain")
    expect(
      normalizeMessageContent([{ type: "text", text: "a" }, { text: "b" }])
    ).toBe("ab")
    expect(normalizeMessageContent({ text: "c" })).toBe("c")
    expect(normalizeMessageContent(42)).toBe("42")
    expect(normalizeMessageContent(null)).toBe("")
  })
})

describe("buildPromptParts", () => {
  it("hoists system messages and prefixes the rest by role", () => {
    const { parts, system, lastUserMsg } = buildPromptParts([
      { role: "system", content: "be terse" },
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "second" }
    ])

    expect(system).toBe("be terse")
    expect(lastUserMsg).toBe("second")
    expect(
      parts.map((part) => (part.type === "text" ? part.text : part.mime))
    ).toEqual(["USER: first", "ASSISTANT: answer", "USER: second"])
  })

  it("renders a replayed tool exchange instead of dropping it", () => {
    const { parts } = buildPromptParts([
      { role: "user", content: "which tabs?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_9",
            type: "function",
            function: { name: "list_tabs", arguments: '{"limit":2}' }
          }
        ]
      },
      { role: "tool", tool_call_id: "call_9", content: '{"tabs":[]}' },
      { role: "user", content: "thanks" }
    ])

    expect(
      parts.map((part) => (part.type === "text" ? part.text : part.mime))
    ).toEqual([
      "USER: which tabs?",
      'ASSISTANT: [called tools] list_tabs({"limit":2})',
      'TOOL RESULT (list_tabs): {"tabs":[]}',
      "USER: thanks"
    ])
  })

  it("keeps an assistant message that has content and no tool calls", () => {
    const { parts } = buildPromptParts([
      { role: "assistant", content: "hello", tool_calls: [] }
    ])
    expect(parts).toEqual([{ type: "text", text: "ASSISTANT: hello" }])
  })
})

describe("extractTrailingToolResults", () => {
  it("returns the contiguous tool messages that end the request", () => {
    expect(
      extractTrailingToolResults([
        { role: "user", content: "hi" },
        { role: "tool", tool_call_id: "call_old", content: "stale" },
        { role: "assistant", content: "", tool_calls: [{ id: "call_a" }] },
        { role: "tool", tool_call_id: "call_a", content: "A" },
        { role: "tool", tool_call_id: "call_b", content: "B" }
      ])
    ).toEqual([
      { toolCallId: "call_a", content: "A" },
      { toolCallId: "call_b", content: "B" }
    ])
  })

  it("returns nothing when the last message is not a tool result", () => {
    expect(
      extractTrailingToolResults([
        { role: "tool", tool_call_id: "call_a", content: "A" },
        { role: "user", content: "next question" }
      ])
    ).toEqual([])
  })

  it("ignores a tool message with no call id, which cannot be correlated", () => {
    expect(
      extractTrailingToolResults([{ role: "tool", content: "orphan" }])
    ).toEqual([])
  })
})

describe("buildToolFlags", () => {
  it("disables every OpenCode tool that was not explicitly allowed", () => {
    expect(
      buildToolFlags({
        discoveredIds: ["bash", "read", "websearch"],
        bridgeNames: ["list_tabs"],
        allowedNativeTools: ["websearch"]
      })
    ).toEqual({
      bash: false,
      read: false,
      websearch: true,
      list_tabs: true
    })
  })

  it("enables a bridge tool even when OpenCode reports the same id", () => {
    expect(
      buildToolFlags({
        discoveredIds: ["read"],
        bridgeNames: ["read"]
      })
    ).toEqual({ read: true })
  })
})

describe("chunk builders", () => {
  it("emits OpenAI tool-call fragments with indexes and JSON arguments", () => {
    const chunk = toolCallsChunk("chatcmpl-1", "opencode/model", [
      parked(),
      parked({ callId: "call_2", tool: "read_tab", args: {} })
    ])

    expect(chunk.choices[0]?.delta).toEqual({
      tool_calls: [
        {
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: "list_tabs", arguments: '{"limit":5}' }
        },
        {
          index: 1,
          id: "call_2",
          type: "function",
          function: { name: "read_tab", arguments: "{}" }
        }
      ]
    })
    expect(chunk.choices[0]?.finish_reason).toBeNull()
  })

  it("marks the finish reason that tells a client to run the tools", () => {
    expect(
      finishChunk("chatcmpl-1", "opencode/model", "tool_calls").choices[0]
        ?.finish_reason
    ).toBe("tool_calls")
  })
})

describe("image parts", () => {
  const dataUrl = "data:image/webp;base64,AAAA"

  it("carries an attached image through as a file part", () => {
    const { parts } = buildPromptParts([
      {
        role: "user",
        content: [
          { type: "text", text: "what are these bro?" },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ])

    expect(parts).toEqual([
      { type: "text", text: "USER: what are these bro?" },
      {
        type: "file",
        mime: "image/webp",
        filename: "image-1.webp",
        url: dataUrl
      }
    ])
  })

  it("keeps an image-only message instead of dropping it", () => {
    const { parts } = buildPromptParts([
      { role: "user", content: [{ type: "image_url", image_url: dataUrl }] }
    ])

    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ type: "file", mime: "image/webp" })
  })

  it("numbers several images and names them by media type", () => {
    const { parts } = buildPromptParts([
      {
        role: "user",
        content: [
          { type: "text", text: "compare" },
          { type: "image_url", image_url: { url: "data:image/png;base64,A" } },
          {
            type: "input_image",
            image_url: { url: "data:image/jpeg;base64,B" }
          }
        ]
      }
    ])

    expect(parts.filter((part) => part.type === "file")).toEqual([
      {
        type: "file",
        mime: "image/png",
        filename: "image-1.png",
        url: "data:image/png;base64,A"
      },
      {
        type: "file",
        mime: "image/jpeg",
        filename: "image-2.jpg",
        url: "data:image/jpeg;base64,B"
      }
    ])
  })

  it("reads a remote image's type from its extension, defaulting to png", () => {
    expect(imageMimeFromUrl("https://example.test/a.JPG?v=2")).toBe(
      "image/jpeg"
    )
    expect(imageMimeFromUrl("https://example.test/render")).toBe("image/png")
  })

  it("ignores a part with no usable url", () => {
    expect(extractImageParts([{ type: "image_url", image_url: {} }])).toEqual(
      []
    )
    expect(extractImageParts("plain text")).toEqual([])
  })

  it("emits generated images as inline output parts", () => {
    expect(
      imageChunk("chatcmpl-1", "codex/image-generation", {
        b64Json: "AAAA",
        revisedPrompt: "A red square"
      }).choices[0]?.delta
    ).toEqual({
      content: [
        {
          type: "output_image",
          b64_json: "AAAA",
          revised_prompt: "A red square"
        }
      ]
    })
  })
})
