import { beforeEach, describe, expect, it, vi } from "vitest"
import { MESSAGE_KEYS } from "@/lib/constants"
import {
  startSelectionActionStream,
  stopSelectionStream
} from "../content-stream"
import type { SelectionCapture } from "../dom"
import { createSelectionOverlayState } from "../overlay-state"

// ── mock chrome.runtime.connect ───────────────────────────────────────────────

const makeMockPort = () => {
  const messageListeners: Array<(msg: unknown) => void> = []
  const disconnectListeners: Array<() => void> = []

  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: { addListener: vi.fn((fn) => messageListeners.push(fn)) },
    onDisconnect: { addListener: vi.fn((fn) => disconnectListeners.push(fn)) },
    _emit: (msg: unknown) => {
      for (const fn of messageListeners) fn(msg)
    },
    _disconnect: () => {
      for (const fn of disconnectListeners) fn()
    }
  }
}

const makeCapture = (): SelectionCapture => ({
  text: "Hello world",
  rect: {
    top: 100,
    bottom: 120,
    left: 50,
    right: 250,
    width: 200,
    height: 20
  } as DOMRect,
  range: null,
  canReplace: false,
  canInsert: false,
  selectionType: "plain-text"
})

beforeEach(() => {
  global.chrome = {
    ...global.chrome,
    runtime: {
      ...global.chrome?.runtime,
      connect: vi.fn(),
      lastError: undefined
    }
  } as unknown as typeof chrome
})

// ── startSelectionActionStream ────────────────────────────────────────────────

describe("startSelectionActionStream", () => {
  it("dispatches stream.start immediately before any chunk arrives", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const dispatch = vi.fn()
    startSelectionActionStream({
      capture: makeCapture(),
      state: createSelectionOverlayState(),
      panelModel: "",
      dispatch,
      render: vi.fn(),
      onFinish: vi.fn()
    })

    expect(dispatch).toHaveBeenCalledWith({ type: "stream.start" })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it("passes the correct actionId from state in the request", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    let state = createSelectionOverlayState()
    state = { ...state, currentAction: "shorten" }

    startSelectionActionStream({
      capture: makeCapture(),
      state,
      panelModel: "deepseek-r1:8b",
      dispatch: vi.fn(),
      render: vi.fn(),
      onFinish: vi.fn()
    })

    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ actionId: "shorten" })
      })
    )
  })

  it("passes customInstruction in the request when set", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const state = {
      ...createSelectionOverlayState(),
      currentAction: "custom" as const,
      customInstruction: "Translate to French"
    }

    startSelectionActionStream({
      capture: makeCapture(),
      state,
      panelModel: "",
      dispatch: vi.fn(),
      render: vi.fn(),
      onFinish: vi.fn()
    })

    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          customInstruction: "Translate to French"
        })
      })
    )
  })

  it("dispatches stream.chunk for each incoming chunk", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const dispatch = vi.fn()
    startSelectionActionStream({
      capture: makeCapture(),
      state: createSelectionOverlayState(),
      panelModel: "",
      dispatch,
      render: vi.fn(),
      onFinish: vi.fn()
    })

    port._emit({
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK,
      payload: { delta: "Hello ", thinkingDelta: "" }
    })
    port._emit({
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK,
      payload: { delta: "world", thinkingDelta: "" }
    })

    const chunks = dispatch.mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === "stream.chunk")
    expect(chunks).toHaveLength(2)
    expect(chunks[0].visibleDelta).toBe("Hello ")
    expect(chunks[1].visibleDelta).toBe("world")
  })

  it("dispatches stream.done and calls onFinish when done", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const dispatch = vi.fn()
    const onFinish = vi.fn()
    startSelectionActionStream({
      capture: makeCapture(),
      state: createSelectionOverlayState(),
      panelModel: "",
      dispatch,
      render: vi.fn(),
      onFinish
    })

    port._emit({ type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_DONE })

    expect(dispatch).toHaveBeenCalledWith({ type: "stream.done" })
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it("dispatches stream.error and calls onFinish on error", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const dispatch = vi.fn()
    const onFinish = vi.fn()
    startSelectionActionStream({
      capture: makeCapture(),
      state: createSelectionOverlayState(),
      panelModel: "",
      dispatch,
      render: vi.fn(),
      onFinish
    })

    port._emit({
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR,
      error: { message: "Model not loaded" }
    })

    expect(dispatch).toHaveBeenCalledWith({
      type: "stream.error",
      message: "Model not loaded"
    })
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it("returns the live port for later cancellation", () => {
    const port = makeMockPort()
    vi.mocked(chrome.runtime.connect).mockReturnValue(
      port as unknown as chrome.runtime.Port
    )

    const returned = startSelectionActionStream({
      capture: makeCapture(),
      state: createSelectionOverlayState(),
      panelModel: "",
      dispatch: vi.fn(),
      render: vi.fn(),
      onFinish: vi.fn()
    })

    expect(returned).toBe(port)
  })
})

// ── stopSelectionStream ───────────────────────────────────────────────────────

describe("stopSelectionStream", () => {
  it("posts cancel message and disconnects the port", () => {
    const port = makeMockPort()

    stopSelectionStream(port as unknown as chrome.runtime.Port)

    expect(port.postMessage).toHaveBeenCalledWith({
      type: MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION
    })
    expect(port.disconnect).toHaveBeenCalledOnce()
  })

  it("returns null after stopping", () => {
    const port = makeMockPort()
    const result = stopSelectionStream(port as unknown as chrome.runtime.Port)
    expect(result).toBeNull()
  })

  it("is a no-op for null port and returns null", () => {
    const result = stopSelectionStream(null)
    expect(result).toBeNull()
  })
})
