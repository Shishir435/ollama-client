import { beforeEach, describe, expect, it } from "vitest"
import { chatInputStore } from "../chat-input-store"

describe("chatInputStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    chatInputStore.setState({ input: "", pendingChatSend: undefined })
  })

  it("should initialize with empty input", () => {
    const state = chatInputStore.getState()
    expect(state.input).toBe("")
  })

  it("should set input", () => {
    const { setInput } = chatInputStore.getState()
    setInput("Hello world")

    expect(chatInputStore.getState().input).toBe("Hello world")
  })

  it("should append input", () => {
    const { setInput, appendInput } = chatInputStore.getState()

    setInput("Hello")
    appendInput(" world")

    expect(chatInputStore.getState().input).toBe("Hello world")
  })

  it("should handle multiple appends", () => {
    const { appendInput } = chatInputStore.getState()

    appendInput("First")
    appendInput(" Second")
    appendInput(" Third")

    expect(chatInputStore.getState().input).toBe("First Second Third")
  })

  it("should replace input with setInput", () => {
    const { setInput } = chatInputStore.getState()

    setInput("Initial")
    setInput("Replaced")

    expect(chatInputStore.getState().input).toBe("Replaced")
  })

  it("queues and clears a one-time chat send", () => {
    const { queueChatSend, clearPendingChatSend } = chatInputStore.getState()

    queueChatSend("Test message")
    expect(chatInputStore.getState().pendingChatSend).toBe("Test message")

    clearPendingChatSend()
    expect(chatInputStore.getState().pendingChatSend).toBeUndefined()
  })
})

describe("a drafted follow-up", () => {
  beforeEach(() => {
    chatInputStore.getState().dropAgentFollowUp()
  })

  const draft = () =>
    chatInputStore
      .getState()
      .draftFollowUp("Continue the browser task.", "run-7", "chat-1")

  it("rides on the drafted message sent to the chat it was drafted in", () => {
    draft()

    expect(
      chatInputStore
        .getState()
        .takeAgentFollowUpRunId(" Continue the browser task. ", "chat-1")
    ).toBe("run-7")
    expect(
      chatInputStore
        .getState()
        .takeAgentFollowUpRunId("Continue the browser task.", "chat-1")
    ).toBeUndefined()
  })

  /**
   * A draft edited into another request is a new request: following the old
   * card's run would inherit its record and the effects it committed.
   */
  it("follows nothing once the draft is repurposed", () => {
    draft()
    expect(
      chatInputStore
        .getState()
        .takeAgentFollowUpRunId("Find the cheapest plan instead", "chat-1")
    ).toBeUndefined()

    draft()
    expect(
      chatInputStore
        .getState()
        .takeAgentFollowUpRunId("Continue the browser task.", "chat-2")
    ).toBeUndefined()
  })
})
