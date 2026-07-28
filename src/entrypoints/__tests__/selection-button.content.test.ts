import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import selectionButton from "@/entrypoints/selection-button.content"
import type { SelectionOverlayLoadRequest } from "@/protocol/content-messages"
import type { ChromeResponse } from "@/types/messaging"

describe("selection button bootstrap", () => {
  let invalidate: (() => void) | undefined
  let reply: ((response?: ChromeResponse) => void) | undefined
  const sendMessage = vi.fn(
    (
      _message: unknown,
      callback: (response?: ChromeResponse) => void
    ): void => {
      reply = callback
    }
  )

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "selected text"
    } as Selection)
    Object.assign(chrome.runtime, { sendMessage })

    const definition = selectionButton as unknown as {
      main: (ctx: { onInvalidated: (callback: () => void) => void }) => void
    }
    definition.main({
      onInvalidated: (callback) => {
        invalidate = callback
      }
    })
  })

  afterEach(() => {
    invalidate?.()
    Reflect.deleteProperty(chrome.runtime, "lastError")
    vi.useRealTimers()
  })

  const selectText = () => {
    document.dispatchEvent(new Event("selectionchange"))
    vi.advanceTimersByTime(80)
  }

  const currentRequest = (): SelectionOverlayLoadRequest => {
    const message = sendMessage.mock.calls.at(-1)?.[0] as
      | { payload?: SelectionOverlayLoadRequest }
      | undefined
    if (!message?.payload) throw new Error("Expected overlay request payload")
    return message.payload
  }

  const successfulResponse = (): ChromeResponse => {
    const request = currentRequest()
    return {
      success: true,
      data: {
        requestId: request.requestId,
        tabId: 17,
        frameId: 0,
        documentId: "document-1"
      }
    }
  }

  it("retries after the background reports an injection failure", () => {
    selectText()
    expect(sendMessage).toHaveBeenCalledTimes(1)

    reply?.({
      success: false,
      error: { status: 0, message: "Frame navigated" }
    })
    selectText()

    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it("retries after a runtime messaging failure", () => {
    selectText()
    Object.defineProperty(chrome.runtime, "lastError", {
      configurable: true,
      value: { message: "Extension context invalidated" }
    })
    reply?.()
    Reflect.deleteProperty(chrome.runtime, "lastError")
    selectText()

    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it("keeps the latch after successful injection", () => {
    selectText()
    reply?.(successfulResponse())
    selectText()

    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("retries when a response does not match its request identity", () => {
    selectText()
    reply?.({
      success: true,
      data: {
        requestId: "stale-request",
        tabId: 17,
        frameId: 0
      }
    })
    selectText()

    expect(sendMessage).toHaveBeenCalledTimes(2)
  })
})
