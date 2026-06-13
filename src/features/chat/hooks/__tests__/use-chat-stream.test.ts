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

  it("surfaces a thinking-only final response as visible content", () => {
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
      content: "This is the answer.",
      thinking: undefined,
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
        "Provider failed. Check the selected provider, model, and provider logs. This may be temporary; try again."
    })
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
      type: PROVIDER_MESSAGE_KEYS.STOP_GENERATION
    })
    expect(setIsLoading).toHaveBeenCalledWith(false)
    expect(setIsStreaming).toHaveBeenCalledWith(false)
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
