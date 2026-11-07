import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/types"
import {
  EMPTY_REPLY_PLACEHOLDER,
  replayableHistory
} from "../conversation-history"

const user = (content: string): ChatMessage => ({ role: "user", content })
const assistant = (
  content: string,
  extra: Partial<ChatMessage> = {}
): ChatMessage => ({ role: "assistant", content, done: true, ...extra })

describe("replayableHistory", () => {
  it("drops an empty reply that does not sit between two user turns", () => {
    const history = [
      user("first"),
      assistant("answer"),
      assistant("", { metrics: { emptyResponse: true } }),
      user("second")
    ]

    expect(replayableHistory(history)).toEqual([
      history[0],
      history[1],
      history[3]
    ])
  })

  it("drops a trailing empty reply", () => {
    const history = [user("first"), assistant("")]

    expect(replayableHistory(history)).toEqual([history[0]])
  })

  it("keeps roles alternating when an empty reply sat between two user turns", () => {
    const history = [
      user("first"),
      assistant("", { id: "a1", metrics: { emptyResponse: true } }),
      user("second")
    ]

    const sent = replayableHistory(history)

    expect(sent.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user"
    ])
    expect(sent[1]).toEqual({
      id: "a1",
      role: "assistant",
      content: EMPTY_REPLY_PLACEHOLDER,
      done: true
    })
  })

  it("collapses several empty replies between user turns into one placeholder", () => {
    const history = [
      user("first"),
      assistant(""),
      assistant("   "),
      user("second")
    ]

    expect(replayableHistory(history).map((m) => m.content)).toEqual([
      "first",
      EMPTY_REPLY_PLACEHOLDER,
      "second"
    ])
  })

  it("replaces a reasoning-only reply without sending its reasoning or a notice", () => {
    const history = [
      user("first"),
      assistant("  ", {
        thinking: "pondering",
        metrics: { thinkingOnlyResponse: true }
      }),
      user("second")
    ]

    const sent = replayableHistory(history)

    expect(sent.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user"
    ])
    expect(JSON.stringify(sent)).not.toContain("pondering")
    expect(JSON.stringify(sent)).not.toContain("thinkingOnlyResponse")
  })

  it("keeps assistant rows that replay something other than text", () => {
    const history = [
      assistant("", {
        toolCalls: [{ id: "c1", name: "f", arguments: {} }]
      }),
      assistant("", {
        images: [
          {
            imageId: "i1",
            fileName: "a.png",
            mimeType: "image/png",
            size: 1,
            base64: "AA=="
          }
        ]
      }),
      assistant("", { agentRunId: "run-1" }),
      assistant("answer")
    ]

    expect(replayableHistory(history)).toEqual(history)
  })

  it("never drops an empty user or tool row", () => {
    const history: ChatMessage[] = [
      user(""),
      { role: "tool", content: "", toolCallId: "c1" }
    ]

    expect(replayableHistory(history)).toEqual(history)
  })
})
