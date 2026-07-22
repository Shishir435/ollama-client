import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage } from "@/types"

type UpdateMessageFn = (
  messageId: number,
  updates: Partial<ChatMessage>,
  skipDb?: boolean
) => Promise<void>

// Mock the two hook dependencies. We capture the setMessages callback
// passed to useChatStream so the test can invoke it directly and
// assert the streaming-bridge behavior in isolation.
let capturedSetMessages:
  | ((messages: Array<Record<string, unknown>>) => Promise<void> | void)
  | null = null
let capturedOnSuccessfulResponse:
  | ((message: ChatMessage) => Promise<void> | void)
  | null = null

const embedMessages = vi.fn(async () => undefined)
const touchMessageActivity = vi.fn(async (_id: number) => undefined)
const completeOnboarding = vi.fn(async (_sessionId: string | null) => true)

vi.mock("@/lib/onboarding/state", () => ({
  completeOnboardingAfterFirstResponse: (sessionId: string | null) =>
    completeOnboarding(sessionId)
}))

vi.mock("@/lib/repositories/chat-history", () => ({
  touchMessageActivity: (id: number) => touchMessageActivity(id)
}))

vi.mock("@/features/chat/hooks/use-chat-stream", () => ({
  useChatStream: vi.fn(
    (config: {
      setMessages: typeof capturedSetMessages
      onSuccessfulResponse?: typeof capturedOnSuccessfulResponse
    }) => {
      capturedSetMessages = config.setMessages
      capturedOnSuccessfulResponse = config.onSuccessfulResponse ?? null
      return {
        startStream: vi.fn(),
        stopStream: vi.fn()
      }
    }
  )
}))

vi.mock("@/features/chat/hooks/use-auto-embed-messages", () => ({
  useAutoEmbedMessages: vi.fn(() => ({ embedMessages }))
}))

import { useChatStreaming } from "../use-chat-streaming"

const mkOptions = (
  overrides: Partial<Parameters<typeof useChatStreaming>[0]> = {}
) => {
  const updateMessage = vi.fn<UpdateMessageFn>(async () => undefined)
  const setIsLoading = vi.fn()
  const setIsStreaming = vi.fn()
  return {
    options: {
      currentSessionId: "s1",
      updateMessage,
      setIsLoading,
      setIsStreaming,
      ...overrides
    },
    spies: { updateMessage, setIsLoading, setIsStreaming }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  capturedSetMessages = null
  capturedOnSuccessfulResponse = null
  embedMessages.mockClear()
  touchMessageActivity.mockClear()
  completeOnboarding.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useChatStreaming", () => {
  it("exposes startStream, stopStream, and the streaming-id ref", () => {
    const { options } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    expect(typeof result.current.startStream).toBe("function")
    expect(typeof result.current.stopStream).toBe("function")
    expect(result.current.currentStreamingMessageIdRef.current).toBeNull()
  })

  it("no-op when no streaming id is set", async () => {
    const { options, spies } = mkOptions()
    renderHook(() => useChatStreaming(options))

    await capturedSetMessages?.([{ id: 1, content: "hi" }])

    expect(spies.updateMessage).not.toHaveBeenCalled()
  })

  it("no-op when the streamed messages array is empty", async () => {
    const { options, spies } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingMessageIdRef.current = 42

    await capturedSetMessages?.([])

    expect(spies.updateMessage).not.toHaveBeenCalled()
  })

  it("non-done streamed chunk: writes UI immediately (skipDb=true) and schedules a DB write", async () => {
    const { options, spies } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingMessageIdRef.current = 7

    await capturedSetMessages?.([
      {
        id: 7,
        content: "partial",
        thinking: "thinking text",
        done: false,
        metrics: { eval_count: 1 }
      }
    ])

    // First call: UI-only update with skipDb=true.
    expect(spies.updateMessage).toHaveBeenCalledTimes(1)
    expect(spies.updateMessage).toHaveBeenNthCalledWith(
      1,
      7,
      expect.objectContaining({
        content: "partial",
        thinking: "thinking text",
        done: false
      }),
      true
    )

    // No DB write yet — debounce hasn't fired.
    expect(spies.updateMessage).toHaveBeenCalledTimes(1)

    // Advance to the debounce horizon.
    vi.advanceTimersByTime(1000)

    // Second call: DB write (skipDb=false) with content + thinking only.
    expect(spies.updateMessage).toHaveBeenCalledTimes(2)
    expect(spies.updateMessage).toHaveBeenNthCalledWith(
      2,
      7,
      { content: "partial", thinking: "thinking text" },
      false
    )
  })

  it("beats liveness on a timer while streaming and stops when done", async () => {
    const { options } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingMessageIdRef.current = 21

    // A quiet stream: one non-done chunk, then no further tokens.
    await capturedSetMessages?.([{ id: 21, content: "", done: false }])

    // The liveness beat fires on its own timer, independent of tokens, so a
    // slow/quiet provider keeps its row fresh past the staleness window.
    await vi.advanceTimersByTimeAsync(8000)
    expect(touchMessageActivity).toHaveBeenCalledWith(21)
    await vi.advanceTimersByTimeAsync(8000)
    expect(touchMessageActivity).toHaveBeenCalledTimes(2)

    // The terminal chunk stops the beat.
    await capturedSetMessages?.([{ id: 21, content: "answer", done: true }])
    touchMessageActivity.mockClear()
    await vi.advanceTimersByTimeAsync(16000)
    expect(touchMessageActivity).not.toHaveBeenCalled()
  })

  it("stopStream halts the liveness beat", async () => {
    const { options } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingMessageIdRef.current = 22

    await capturedSetMessages?.([{ id: 22, content: "", done: false }])
    result.current.stopStream()
    touchMessageActivity.mockClear()
    await vi.advanceTimersByTimeAsync(16000)
    expect(touchMessageActivity).not.toHaveBeenCalled()
  })

  it("non-done thinking-only chunk writes thinking to UI immediately", async () => {
    const { options, spies } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingMessageIdRef.current = 8

    await capturedSetMessages?.([
      {
        id: 8,
        content: "",
        thinking: "thinking is streaming",
        done: false
      }
    ])

    expect(spies.updateMessage).toHaveBeenCalledTimes(1)
    expect(spies.updateMessage).toHaveBeenCalledWith(
      8,
      expect.objectContaining({
        content: "",
        thinking: "thinking is streaming",
        done: false
      }),
      true
    )
  })

  it("rapid chunks coalesce into one DB write (debounce reset)", async () => {
    const { options, spies } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingMessageIdRef.current = 3

    await capturedSetMessages?.([{ id: 3, content: "a", done: false }])
    vi.advanceTimersByTime(500)
    await capturedSetMessages?.([{ id: 3, content: "ab", done: false }])
    vi.advanceTimersByTime(500)
    await capturedSetMessages?.([{ id: 3, content: "abc", done: false }])
    // 3 UI updates so far, debounce reset twice -> no DB write yet.
    expect(spies.updateMessage).toHaveBeenCalledTimes(3)
    const skipDbCalls = spies.updateMessage.mock.calls.filter(
      (call) => call[2] === false
    )
    expect(skipDbCalls).toHaveLength(0)

    // Now let the final debounce mature.
    vi.advanceTimersByTime(1000)
    const finalDbWrites = spies.updateMessage.mock.calls.filter(
      (call) => call[2] === false
    )
    expect(finalDbWrites).toHaveLength(1)
    expect(finalDbWrites[0][1]).toEqual({ content: "abc", thinking: undefined })
  })

  it("done=true: cancels the pending debounce and flushes DB synchronously, then embeds", async () => {
    const { options, spies } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingMessageIdRef.current = 11

    // First a partial chunk that schedules a DB write.
    await capturedSetMessages?.([{ id: 11, content: "part", done: false }])
    expect(spies.updateMessage).toHaveBeenCalledTimes(1)

    // Now the done chunk lands.
    const finalMessages = [
      {
        id: 11,
        content: "complete",
        thinking: "done thinking",
        replayArtifact: {
          version: 1 as const,
          wire: "openai" as const,
          providerId: "openrouter",
          model: "m",
          blocks: [{ type: "reasoning.encrypted", data: "opaque" }]
        },
        done: true,
        metrics: { eval_count: 5 }
      }
    ]
    await capturedSetMessages?.(finalMessages)

    // UI update first (skipDb=true), then immediate DB flush (skipDb=false).
    expect(spies.updateMessage).toHaveBeenCalledTimes(3)
    expect(spies.updateMessage).toHaveBeenNthCalledWith(
      2,
      11,
      expect.objectContaining({ content: "complete", done: true }),
      true
    )
    expect(spies.updateMessage).toHaveBeenNthCalledWith(
      3,
      11,
      expect.objectContaining({
        content: "complete",
        done: true,
        replayArtifact: finalMessages[0].replayArtifact
      }),
      false
    )

    // Background embed kicked off.
    expect(embedMessages).toHaveBeenCalledTimes(1)
    expect(embedMessages).toHaveBeenCalledWith(finalMessages, "s1", false)

    // The pending debounce should not produce a 4th write even if time
    // advances now.
    vi.advanceTimersByTime(5000)
    expect(spies.updateMessage).toHaveBeenCalledTimes(3)
  })

  it("done=true with no current session id: flushes DB but does NOT call embed", async () => {
    const { options, spies } = mkOptions({ currentSessionId: null })
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingMessageIdRef.current = 1

    await capturedSetMessages?.([{ id: 1, content: "x", done: true }])

    expect(spies.updateMessage).toHaveBeenCalledTimes(2) // UI + DB flush
    expect(embedMessages).not.toHaveBeenCalled()
  })

  it("completes onboarding only from explicit successful-response callback", async () => {
    const { options } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingSessionIdRef.current = "s1"

    expect(completeOnboarding).not.toHaveBeenCalled()
    await capturedOnSuccessfulResponse?.({
      role: "assistant",
      content: "hello",
      done: true
    })
    expect(completeOnboarding).toHaveBeenCalledWith("s1")
  })

  it("falls back to the last message in newMessages when the streamed id isn't in the array", async () => {
    const { options, spies } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingMessageIdRef.current = 99

    await capturedSetMessages?.([
      { id: 1, content: "first" },
      { id: 2, content: "second", done: false }
    ])

    // Falls back to last entry — content "second" applied against id 99.
    expect(spies.updateMessage).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ content: "second" }),
      true
    )
  })

  it("an embed failure is logged but does not throw out of setMessages", async () => {
    embedMessages.mockRejectedValueOnce(new Error("embed offline"))

    const { options } = mkOptions()
    const { result } = renderHook(() => useChatStreaming(options))
    result.current.currentStreamingMessageIdRef.current = 5

    // The setMessages callback awaits the DB flush but the embed call
    // is fired-and-forgotten with `.catch`. So no rejection escapes.
    await expect(
      capturedSetMessages?.([{ id: 5, content: "done", done: true }])
    ).resolves.not.toThrow()
  })
})
