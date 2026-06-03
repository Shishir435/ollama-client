import { beforeEach, describe, expect, it, vi } from "vitest"
import { MESSAGE_KEYS } from "@/lib/constants"
import { connectSelectionStream } from "../overlay-stream"
import type { SelectionActionRequest } from "../types"

const request: SelectionActionRequest = {
  actionId: "summarize",
  selection: {
    selectedText: "Some text to summarize.",
    pageUrl: "https://example.com",
    pageTitle: "Test",
    selectionType: "plain-text",
    canReplace: false,
    canInsert: false
  }
}

const makeMockPort = () => {
  const messageListeners: Array<(msg: unknown) => void> = []
  const disconnectListeners: Array<() => void> = []

  return {
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn) => messageListeners.push(fn))
    },
    onDisconnect: {
      addListener: vi.fn((fn) => disconnectListeners.push(fn))
    },
    _emit: (msg: unknown) => {
      for (const fn of messageListeners) fn(msg)
    },
    _disconnect: () => {
      for (const fn of disconnectListeners) fn()
    }
  }
}

beforeEach(() => {
  global.chrome = {
    ...global.chrome,
    runtime: {
      ...global.chrome.runtime,
      connect: vi.fn(),
      lastError: undefined
    }
  } as unknown as typeof chrome
})

describe("connectSelectionStream", () => {
  it("posts START_SELECTION_ACTION message to port on connect", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    connectSelectionStream(request, {
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn()
    })

    expect(chrome.runtime.connect).toHaveBeenCalledWith({
      name: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION
    })
    expect(port.postMessage).toHaveBeenCalledWith({
      type: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
      payload: request
    })
  })

  it("calls onChunk with visibleDelta for SELECTION_ACTION_CHUNK message", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const onChunk = vi.fn()
    connectSelectionStream(request, {
      onChunk,
      onDone: vi.fn(),
      onError: vi.fn()
    })

    port._emit({
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK,
      payload: { delta: "Hello world", thinkingDelta: "" }
    })

    expect(onChunk).toHaveBeenCalledOnce()
    const result = onChunk.mock.calls[0][0]
    expect(result.visibleDelta).toBe("Hello world")
    expect(result.thinkingDelta).toBe("")
    expect(result.isThinking).toBe(false)
  })

  it("calls onDone for SELECTION_ACTION_DONE message", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const onDone = vi.fn()
    connectSelectionStream(request, {
      onChunk: vi.fn(),
      onDone,
      onError: vi.fn()
    })

    port._emit({ type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_DONE })

    expect(onDone).toHaveBeenCalledOnce()
  })

  it("calls onError with message for SELECTION_ACTION_ERROR message", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const onError = vi.fn()
    connectSelectionStream(request, {
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError
    })

    port._emit({
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR,
      error: { message: "Model not loaded" }
    })

    expect(onError).toHaveBeenCalledWith("Model not loaded")
  })

  it("calls onError with fallback when error message is missing", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const onError = vi.fn()
    connectSelectionStream(request, {
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError
    })

    port._emit({ type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR })

    expect(onError).toHaveBeenCalledWith("Selection action failed. Try again.")
  })

  it("calls onError on port disconnect with runtime.lastError", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    Object.defineProperty(chrome.runtime, "lastError", {
      value: { message: "Connection lost" },
      configurable: true
    })

    const onError = vi.fn()
    connectSelectionStream(request, {
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError
    })

    port._disconnect()

    expect(onError).toHaveBeenCalledWith("Connection lost. Try again.")

    Object.defineProperty(chrome.runtime, "lastError", {
      value: undefined,
      configurable: true
    })
  })

  it("does not call onError on clean disconnect (no lastError)", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const onError = vi.fn()
    connectSelectionStream(request, {
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError
    })

    port._disconnect()

    expect(onError).not.toHaveBeenCalled()
  })

  it("tracks isThinking=true when only thinkingDelta arrives before visible text", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const onChunk = vi.fn()
    connectSelectionStream(request, {
      onChunk,
      onDone: vi.fn(),
      onError: vi.fn()
    })

    port._emit({
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK,
      payload: { delta: "", thinkingDelta: "...reasoning..." }
    })

    expect(onChunk).toHaveBeenCalledOnce()
    const result = onChunk.mock.calls[0][0]
    expect(result.isThinking).toBe(true)
    expect(result.thinkingDelta).toBe("...reasoning...")
  })

  it("returns the port from connectSelectionStream", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const returned = connectSelectionStream(request, {
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn()
    })

    expect(returned).toBe(port)
  })
})
