import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import selectionButton from "@/entrypoints/selection-button.content"
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
    reply?.({ success: true })
    selectText()

    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
