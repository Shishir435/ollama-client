import { defineContentScript } from "wxt/utils/define-content-script"
import { MESSAGE_KEYS } from "@/lib/constants/keys"
import {
  CONTENT_MESSAGE_PROTOCOL_VERSION,
  isSelectionOverlayReadyEvent,
  SELECTION_OVERLAY_READY_EVENT,
  type SelectionOverlayLoadResult
} from "@/protocol/content-messages"
import type { ChromeResponse } from "@/types/messaging"

const MIN_SELECTION_CHARS = 3
const OVERLAY_READY_TIMEOUT_MS = 3_000
const createRequestId = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, "0")
  ).join("")

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  main(ctx) {
    let overlayRequested = false
    let cancelPendingReadiness: (() => void) | undefined

    const requestOverlay = () => {
      if (overlayRequested) return
      const selection = window.getSelection()?.toString().trim()
      if (!selection || selection.length < MIN_SELECTION_CHARS) return

      overlayRequested = true
      const requestId = createRequestId()
      let injectionAccepted = false
      let overlayReady = false
      let settled = false

      const cleanupReadiness = () => {
        document.removeEventListener(
          SELECTION_OVERLAY_READY_EVENT,
          handleOverlayReady
        )
        window.clearTimeout(readinessTimeout)
        cancelPendingReadiness = undefined
      }
      const failRequest = () => {
        if (settled) return
        settled = true
        overlayRequested = false
        cleanupReadiness()
      }
      const acceptWhenReady = () => {
        if (settled || !injectionAccepted || !overlayReady) return
        settled = true
        cleanupReadiness()
      }
      const handleOverlayReady = (event: Event) => {
        if (!isSelectionOverlayReadyEvent(event, requestId)) return
        overlayReady = true
        acceptWhenReady()
      }
      const readinessTimeout = window.setTimeout(
        failRequest,
        OVERLAY_READY_TIMEOUT_MS
      )
      document.addEventListener(
        SELECTION_OVERLAY_READY_EVENT,
        handleOverlayReady
      )
      cancelPendingReadiness = failRequest

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
            failRequest()
            return
          }
          injectionAccepted = true
          acceptWhenReady()
        }
      )
    }

    const queueOverlayRequest = () => window.setTimeout(requestOverlay, 80)

    document.addEventListener("selectionchange", queueOverlayRequest, true)
    document.addEventListener("pointerup", queueOverlayRequest, true)
    document.addEventListener("mouseup", queueOverlayRequest, true)
    document.addEventListener("keyup", queueOverlayRequest, true)

    ctx.onInvalidated(() => {
      cancelPendingReadiness?.()
      document.removeEventListener("selectionchange", queueOverlayRequest, true)
      document.removeEventListener("pointerup", queueOverlayRequest, true)
      document.removeEventListener("mouseup", queueOverlayRequest, true)
      document.removeEventListener("keyup", queueOverlayRequest, true)
    })
  }
})
