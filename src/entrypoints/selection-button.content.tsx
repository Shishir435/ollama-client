import { defineContentScript } from "wxt/utils/define-content-script"
import { MESSAGE_KEYS } from "@/lib/constants/keys"

const MIN_SELECTION_CHARS = 3

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  main(ctx) {
    let overlayRequested = false

    const requestOverlay = () => {
      if (overlayRequested) return
      const selection = window.getSelection()?.toString().trim()
      if (!selection || selection.length < MIN_SELECTION_CHARS) return

      overlayRequested = true
      chrome.runtime.sendMessage(
        { type: MESSAGE_KEYS.BROWSER.LOAD_SELECTION_OVERLAY },
        () => {
          void chrome.runtime.lastError
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
