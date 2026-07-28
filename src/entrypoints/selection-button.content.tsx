import { defineContentScript } from "wxt/utils/define-content-script"
import { MESSAGE_KEYS } from "@/lib/constants/keys"
import {
  CONTENT_MESSAGE_PROTOCOL_VERSION,
  type SelectionOverlayLoadResult
} from "@/protocol/content-messages"
import type { ChromeResponse } from "@/types/messaging"

const MIN_SELECTION_CHARS = 3

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  main(ctx) {
    let overlayRequested = false
    let requestSequence = 0

    const requestOverlay = () => {
      if (overlayRequested) return
      const selection = window.getSelection()?.toString().trim()
      if (!selection || selection.length < MIN_SELECTION_CHARS) return

      overlayRequested = true
      requestSequence += 1
      const requestId = `${Date.now()}:${requestSequence}`
      chrome.runtime.sendMessage(
        {
          type: MESSAGE_KEYS.BROWSER.LOAD_SELECTION_OVERLAY,
          payload: {
            version: CONTENT_MESSAGE_PROTOCOL_VERSION,
            requestId,
            document: {
              url: window.location.href,
              isTopFrame: window.top === window
            }
          }
        },
        (response?: ChromeResponse) => {
          const runtimeError = chrome.runtime.lastError
          const result = response?.data as
            | SelectionOverlayLoadResult
            | undefined
          if (
            runtimeError ||
            response?.success !== true ||
            result?.requestId !== requestId
          ) {
            overlayRequested = false
          }
        }
      )
    }

    const queueOverlayRequest = () => window.setTimeout(requestOverlay, 80)

    document.addEventListener("selectionchange", queueOverlayRequest, true)
    document.addEventListener("pointerup", queueOverlayRequest, true)
    document.addEventListener("mouseup", queueOverlayRequest, true)
    document.addEventListener("keyup", queueOverlayRequest, true)

    ctx.onInvalidated(() => {
      document.removeEventListener("selectionchange", queueOverlayRequest, true)
      document.removeEventListener("pointerup", queueOverlayRequest, true)
      document.removeEventListener("mouseup", queueOverlayRequest, true)
      document.removeEventListener("keyup", queueOverlayRequest, true)
    })
  }
})
