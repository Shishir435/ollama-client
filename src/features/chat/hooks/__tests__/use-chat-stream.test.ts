import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "@/lib/browser-api"
import { PROVIDER_MESSAGE_KEYS } from "@/lib/constants/keys"
import { logger } from "@/lib/logger"
import type { UseChatStreamProps } from "../use-chat-stream"
import { useChatStream } from "../use-chat-stream"

const mockToast = vi.hoisted(() => vi.fn())

// Mock browser API
vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      connect: vi.fn()
    }
  }
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast })
}))

describe("useChatStream", () => {
  let mockPort: any
  let setMessages: UseChatStreamProps["setMessages"]
  let setIsLoading: UseChatStreamProps["setIsLoading"]
  let setIsStreaming: UseChatStreamProps["setIsStreaming"]

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Create mock port
    mockPort = {
      postMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn()
      },
      onDisconnect: {
        addListener: vi.fn(),
        removeListener: vi.fn()
      },
      disconnect: vi.fn()
    }

    vi.mocked(browser.runtime.connect).mockReturnValue(mockPort)

    // Create mock setter functions
    setMessages = vi.fn() as UseChatStreamProps["setMessages"]
    setIsLoading = vi.fn() as UseChatStreamProps["setIsLoading"]
    setIsStreaming = vi.fn() as UseChatStreamProps["setIsStreaming"]
  })

  it("should initialize streaming correctly", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    expect(result.current).toHaveProperty("startStream")
    expect(result.current).toHaveProperty("stopStream")
  })

  it("should start stream and set loading state", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "Hello" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    expect(browser.runtime.connect).toHaveBeenCalledWith({
      name: PROVIDER_MESSAGE_KEYS.STREAM_RESPONSE
    })
    expect(setIsLoading).toHaveBeenCalledWith(true)
    expect(setIsStreaming).toHaveBeenCalledWith(false)
  })

  it("should handle streaming chunks", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "Hello" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    // Get the message listener
    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    // Simulate first chunk
    act(() => {
      listener({ delta: "Hello" })
    })

    expect(setIsStreaming).toHaveBeenCalledWith(true)
    expect(setMessages).toHaveBeenCalled()

    // Simulate second chunk
    act(() => {
      listener({ delta: " world" })
    })

    expect(setMessages).toHaveBeenCalledTimes(3) // Initial + 2 chunks
  })

  it("drops duplicate and out-of-order sequenced chunks", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    act(() => {
      result.current.startStream({
        model: "llama2",
        messages: [{ role: "user" as const, content: "Hello" }]
      })
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]
    ;(setMessages as ReturnType<typeof vi.fn>).mockClear()

    act(() => {
      listener({ seq: 0, delta: "Hello" })
      listener({ seq: 1, delta: " world" })
      listener({ seq: 1, delta: " DUP" }) // duplicate seq — dropped
      listener({ seq: 0, delta: " STALE" }) // out-of-order — dropped
    })

    // Only the two in-order chunks were applied.
    expect(setMessages).toHaveBeenCalledTimes(2)
  })

  it("accepts raw provider thinking chunks if normalization is bypassed", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "Hello" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({
        message: {
          role: "assistant",
          content: "",
          thinking: "raw thought"
        },
        done: false
      })
    })

    const latestMessages = vi.mocked(setMessages).mock.calls.at(-1)?.[0]
    expect(latestMessages?.at(-1)).toMatchObject({
      content: "",
      thinking: "raw thought"
    })
  })

  it("should handle stream completion", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "Hello" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({ delta: "Response" })
      listener({ done: true, metrics: { total_duration: 1000 } })
    })

    expect(setIsLoading).toHaveBeenCalledWith(false)
    expect(setIsStreaming).toHaveBeenCalledWith(false)
    expect(mockPort.disconnect).toHaveBeenCalled()
  })

  it("keeps opaque replay state separate on the assistant message", () => {
    const { result } = renderHook(() =>
      useChatStream({ setMessages, setIsLoading, setIsStreaming })
    )
    act(() => {
      result.current.startStream({
        model: "remote-model",
        messages: [{ role: "user", content: "Hello" }]
      })
    })
    const listener = mockPort.onMessage.addListener.mock.calls[0][0]
    const replayArtifact = {
      version: 1,
      wire: "openai",
      providerId: "openrouter",
      model: "remote-model",
      blocks: [{ type: "reasoning.encrypted", data: "opaque" }]
    }

    act(() => {
      listener({ delta: "Answer" })
      listener({ done: true, replayArtifact })
    })

    const latestMessages = vi.mocked(setMessages).mock.calls.at(-1)?.[0]
    expect(latestMessages?.at(-1)).toMatchObject({
      content: "Answer",
      replayArtifact
    })
  })

  it("shows a safe fallback when the model returns only thinking", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "what is this?" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({ thinkingDelta: "This is the answer." })
      listener({ done: true })
    })

    const finalMessages = vi.mocked(setMessages).mock.calls.at(-1)?.[0]
    expect(finalMessages?.at(-1)).toMatchObject({
      role: "assistant",
      content:
        "I did not receive a final answer from the model. Please try again.",
      thinking: "This is the answer.",
      metrics: {
        thinkingOnlyResponse: true
      },
      done: true
    })
  })

  it("uses thinking as visible content when a tool-backed turn returns only thinking", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "who is current PM?" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({
        toolRuns: [
          {
            toolId: "web_search",
            label: "web_search",
            status: "done",
            startedAt: 1
          }
        ]
      })
      listener({ thinkingDelta: "The current answer is from web results." })
      listener({ done: true })
    })

    const finalMessages = vi.mocked(setMessages).mock.calls.at(-1)?.[0]
    expect(finalMessages?.at(-1)).toMatchObject({
      role: "assistant",
      content: "The current answer is from web results.",
      thinking: "The current answer is from web results.",
      metrics: {
        thinkingOnlyResponse: true,
        toolRuns: [
          expect.objectContaining({
            toolId: "web_search",
            status: "done"
          })
        ]
      },
      done: true
    })
  })

  it("should handle stream errors", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "Hello" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({
        error: { status: 500, message: "Internal server error" }
      })
    })

    expect(setIsLoading).toHaveBeenCalledWith(false)
    expect(setIsStreaming).toHaveBeenCalledWith(false)
    expect(mockPort.disconnect).toHaveBeenCalled()
  })

  it("preserves the generated assistant id on stream errors", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "Hello" }]
    const generatedMessage = {
      id: 42,
      role: "assistant" as const,
      content: "",
      model: "llama2"
    }

    act(() => {
      result.current.startStream({
        model: "llama2",
        messages,
        generatedMessage
      })
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({
        error: { status: 500, message: "Internal server error" }
      })
    })

    const finalMessages = vi.mocked(setMessages).mock.calls.at(-1)?.[0]
    expect(finalMessages?.at(-1)).toMatchObject({
      id: 42,
      role: "assistant",
      done: true
    })
  })

  it("marks the final assistant message with error metadata for retry", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    act(() => {
      result.current.startStream({
        model: "llama2",
        messages: [{ role: "user" as const, content: "Hello" }]
      })
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({
        error: {
          status: 503,
          message: "connection refused",
          kind: "provider-unavailable",
          retryable: true
        }
      })
    })

    const finalMessages = vi.mocked(setMessages).mock.calls.at(-1)?.[0]
    expect(finalMessages?.at(-1)).toMatchObject({
      role: "assistant",
      done: true,
      error: { status: 503, retryable: true }
    })
  })

  it("should show typed provider errors with guidance", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "Hello" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({
        error: {
          status: 500,
          kind: "provider",
          message: "Provider failed",
          retryable: true
        }
      })
    })

    expect(mockToast).toHaveBeenCalledWith({
      variant: "destructive",
      title: "Provider error",
      description:
        "Provider failed. Check the selected provider, model, and provider logs. This may be temporary; try again.",
      action: {
        label: "Open new issue",
        onClick: expect.any(Function)
      }
    })
  })

  it("names the selected provider and hides the issue URL behind an action", () => {
    const { result } = renderHook(() =>
      useChatStream({ setMessages, setIsLoading, setIsStreaming })
    )
    const messages = [{ role: "user" as const, content: "Hello" }]

    act(() => {
      result.current.startStream({
        model: "gemma.gguf",
        providerId: "llamacpp",
        messages
      })
    })
    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({
        error: {
          status: 500,
          kind: "provider",
          providerId: "llamacpp",
          message: "raw failure",
          userMessage:
            'llama.cpp returned a server error. Check that llama.cpp is running and model "gemma.gguf" is loaded.',
          retryable: true
        }
      })
    })

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "llama.cpp error",
        description: expect.not.stringContaining("https://")
      })
    )
    const lastMessages = vi.mocked(setMessages).mock.calls.at(-1)?.[0]
    expect(lastMessages?.at(-1)?.content).toContain("[Open a new issue](")
    expect(lastMessages?.at(-1)?.content).toContain("llama.cpp")
  })

  it("does not mislabel a generic background 500 as a provider failure", () => {
    const { result } = renderHook(() =>
      useChatStream({ setMessages, setIsLoading, setIsStreaming })
    )

    act(() => {
      result.current.startStream({
        model: "gemma.gguf",
        providerId: "llamacpp",
        messages: [{ role: "user" as const, content: "Hello" }]
      })
    })
    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({
        error: {
          status: 500,
          message: "Tool-loop checkpoint failed"
        }
      })
    })

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "chat.errors.response_failed_title",
        description: "Tool-loop checkpoint failed"
      })
    )
    expect(mockToast).toHaveBeenCalledWith(
      expect.not.objectContaining({ action: expect.anything() })
    )
    const lastMessages = vi.mocked(setMessages).mock.calls.at(-1)?.[0]
    expect(lastMessages?.at(-1)?.content).toBe("chat.errors.unknown_error")
  })

  it("should stop stream correctly", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "Hello" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    act(() => {
      result.current.stopStream()
    })

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      type: PROVIDER_MESSAGE_KEYS.STOP_GENERATION,
      payload: { requestId: expect.any(String) }
    })
    expect(mockPort.disconnect).toHaveBeenCalled()
    expect(setIsLoading).toHaveBeenCalledWith(false)
    expect(setIsStreaming).toHaveBeenCalledWith(false)
  })

  it("reconnects an awaiting approval with the same request id", () => {
    vi.useFakeTimers()
    const resumedPort = {
      postMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn()
      },
      onDisconnect: {
        addListener: vi.fn(),
        removeListener: vi.fn()
      },
      disconnect: vi.fn()
    } as any
    vi.mocked(browser.runtime.connect)
      .mockReturnValueOnce(mockPort)
      .mockReturnValueOnce(resumedPort)

    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    act(() => {
      result.current.startStream({
        model: "llama2",
        messages: [{ role: "user" as const, content: "Hello" }]
      })
    })
    const streamListener = mockPort.onMessage.addListener.mock.calls[0][0]
    act(() => {
      streamListener({
        toolRuns: [
          {
            toolId: "danger",
            callId: "call-1",
            label: "danger",
            status: "awaiting-confirmation",
            startedAt: 1
          }
        ]
      })
      mockPort.onDisconnect.addListener.mock.calls[0][0]()
      vi.advanceTimersByTime(250)
    })

    const originalPayload = mockPort.postMessage.mock.calls[0][0].payload
    expect(resumedPort.postMessage).toHaveBeenCalledWith({
      type: PROVIDER_MESSAGE_KEYS.CHAT_WITH_MODEL,
      payload: originalPayload
    })
    expect(setIsLoading).not.toHaveBeenLastCalledWith(false)
    vi.useRealTimers()
  })

  it("flags an unexpected disconnect as interrupted with the partial preserved", () => {
    const { result } = renderHook(() =>
      useChatStream({ setMessages, setIsLoading, setIsStreaming })
    )
    act(() => {
      result.current.startStream({
        model: "llama2",
        messages: [{ role: "user" as const, content: "Hi" }]
      })
    })
    const streamListener = mockPort.onMessage.addListener.mock.calls[0][0]
    act(() => {
      streamListener({ delta: "partial answer" })
      // Worker death mid-stream, not a tool-confirmation reconnect.
      mockPort.onDisconnect.addListener.mock.calls[0][0]()
    })

    const lastMessages = (setMessages as any).mock.calls.at(-1)[0]
    const assistant = lastMessages.at(-1)
    expect(assistant.done).toBe(true)
    expect(assistant.content).toBe("partial answer")
    expect(assistant.metrics?.interrupted).toBe(true)
  })

  it("persists a clean done:true on a user stop, without the interrupted flag", () => {
    // A user stop calls port.disconnect() ourselves, which does NOT fire our
    // own onDisconnect — so stopStream itself must render the clean completion
    // (no manual disconnect invoked here, mirroring real browser behavior).
    const { result } = renderHook(() =>
      useChatStream({ setMessages, setIsLoading, setIsStreaming })
    )
    act(() => {
      result.current.startStream({
        model: "llama2",
        messages: [{ role: "user" as const, content: "Hi" }]
      })
    })
    const streamListener = mockPort.onMessage.addListener.mock.calls[0][0]
    act(() => {
      streamListener({ delta: "partial answer" })
      result.current.stopStream()
    })

    const lastMessages = (setMessages as any).mock.calls.at(-1)[0]
    const assistant = lastMessages.at(-1)
    expect(assistant.done).toBe(true)
    expect(assistant.content).toBe("partial answer")
    expect(assistant.metrics?.interrupted).toBeUndefined()
  })

  it("should handle stop when port not created", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    act(() => {
      result.current.stopStream()
    })

    expect(logger.warn).toHaveBeenCalledWith(
      "Stop requested but port not created yet",
      "useChatStream"
    )
    expect(setIsLoading).toHaveBeenCalledWith(false)
    expect(setIsStreaming).toHaveBeenCalledWith(false)
  })

  it("should handle stop message failure", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "Hello" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    // Make postMessage throw
    mockPort.postMessage.mockImplementation(() => {
      throw new Error("Port disconnected")
    })

    act(() => {
      result.current.stopStream()
    })

    expect(logger.error).toHaveBeenCalled()
    expect(setIsLoading).toHaveBeenCalledWith(false)
    expect(setIsStreaming).toHaveBeenCalledWith(false)
  })

  it("should handle aborted stream", () => {
    const { result } = renderHook(() =>
      useChatStream({
        setMessages,
        setIsLoading,
        setIsStreaming
      })
    )

    const messages = [{ role: "user" as const, content: "Hello" }]

    act(() => {
      result.current.startStream({ model: "llama2", messages })
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({ aborted: true })
    })

    expect(setIsLoading).toHaveBeenCalledWith(false)
    expect(setIsStreaming).toHaveBeenCalledWith(false)
    expect(mockPort.disconnect).toHaveBeenCalled()
  })
})
