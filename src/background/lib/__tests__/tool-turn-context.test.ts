import { describe, expect, it } from "vitest"

import type { ChatMessage, ChatWithModelMessage } from "@/types"
import { buildToolContext } from "../tool-turn-context"

const turn = (
  messages: ChatMessage[],
  payload: Partial<ChatWithModelMessage["payload"]> = {}
): ChatWithModelMessage => ({
  type: "chat",
  payload: { model: "qwen3", providerId: "ollama", messages, ...payload }
})

const ask: ChatMessage = { role: "user", content: "Find the pricing page" }

describe("buildToolContext", () => {
  it("carries the durable turn's own fields to the tools", () => {
    const signal = new AbortController().signal
    const ctx = buildToolContext(
      turn([ask], {
        sessionId: "chat-1",
        assistantMessageId: 42,
        browserTabId: 7,
        agentFollowUpRunId: "run-3"
      }),
      [ask],
      signal
    )

    expect(ctx).toMatchObject({
      signal,
      sessionId: "chat-1",
      model: "qwen3",
      providerId: "ollama",
      assistantMessageId: 42,
      browserTabId: 7,
      followUpRunId: "run-3",
      pageContentInContext: false
    })
  })

  it("names the branch's newest run as the one a follow-up continues", () => {
    const history: ChatMessage[] = [
      { role: "assistant", content: "", agentRunId: "run-1" },
      { role: "assistant", content: "", agentRunId: "run-2" },
      ask
    ]

    expect(
      buildToolContext(turn(history), history, new AbortController().signal)
        .previousAgentRunId
    ).toBe("run-2")
  })

  /**
   * An earlier turn's page summary or tool result is in the history the model
   * reads now, so a task it writes may be repeating it even though this turn
   * attached nothing.
   */
  it.each([
    ["a tool result", { role: "tool", content: "page text" }],
    [
      "a turn that ran a tool",
      {
        role: "assistant",
        content: "The page says…",
        metrics: {
          toolRuns: [
            { toolId: "current_tab", label: "", status: "done", startedAt: 1 }
          ]
        }
      }
    ],
    [
      "a turn that attached a tab",
      { role: "assistant", content: "…", metrics: { tabContextLength: 900 } }
    ],
    [
      "an agent run's record",
      { role: "assistant", content: "", agentRunId: "run-1" }
    ]
  ] as [
    string,
    ChatMessage
  ][])("treats %s earlier in the chat as page content", (_label, earlier) => {
    const history = [earlier, ask]
    expect(
      buildToolContext(turn(history), history, new AbortController().signal)
        .pageContentInContext
    ).toBe(true)
  })

  it("reads a plain conversation as the user's own words", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello!" },
      ask
    ]

    expect(
      buildToolContext(turn(history), history, new AbortController().signal)
        .pageContentInContext
    ).toBe(false)
  })
})
