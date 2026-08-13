import type { Runtime } from "webextension-polyfill"
import { safeSendResponse } from "@/background/lib/runtime-delivery"
import { postSelectionToSidePanels } from "@/background/lib/selection-bridge"
import { browser, isChromiumBased } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { getErrorMessage } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { setPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import {
  isSelectionOverlayLoadRequest,
  SELECTION_OVERLAY_REQUEST_ID_GLOBAL,
  type SelectionOverlayLoadResult
} from "@/protocol/content-messages"
import type {
  ChromeMessage,
  ChromeSidePanel,
  SendResponseFunction
} from "@/types"

const SELECTION_OVERLAY_FILE = "content-scripts/selection-overlay.js"

const setSelectionOverlayRequestId = (key: string, requestId: string) => {
  Reflect.set(globalThis, key, requestId)
}

export const handleLoadSelectionOverlay = (
  payload: unknown,
  sender: Runtime.MessageSender,
  sendResponse: SendResponseFunction
): true => {
  if (!isSelectionOverlayLoadRequest(payload)) {
    safeSendResponse(sendResponse, {
      success: false,
      error: {
        status: 400,
        message: "Invalid selection overlay request"
      }
    })
    return true
  }

  const tabId = sender.tab?.id
  if (typeof tabId !== "number") {
    safeSendResponse(sendResponse, {
      success: false,
      error: {
        status: 400,
        message: "Selection overlay requires a source tab"
      }
    })
    return true
  }

  const frameId = sender.frameId
  const target = {
    tabId,
    ...(typeof frameId === "number" ? { frameIds: [frameId] } : {})
  }
  browser.scripting
    .executeScript({
      target,
      func: setSelectionOverlayRequestId,
      args: [SELECTION_OVERLAY_REQUEST_ID_GLOBAL, payload.requestId]
    })
    .then(() =>
      browser.scripting.executeScript({
        target,
        files: [SELECTION_OVERLAY_FILE]
      })
    )
    .then(() => {
      const senderWithDocument = sender as Runtime.MessageSender & {
        documentId?: string
      }
      const result: SelectionOverlayLoadResult = {
        requestId: payload.requestId,
        tabId,
        frameId: sender.frameId ?? 0,
        ...(senderWithDocument.documentId
          ? { documentId: senderWithDocument.documentId }
          : {})
      }
      safeSendResponse(sendResponse, { success: true, data: result })
    })
    .catch((error: unknown) => {
      logger.debug("Could not inject selection overlay", "SelectionOverlay", {
        error
      })
      safeSendResponse(sendResponse, {
        success: false,
        error: {
          status: 0,
          message: error instanceof Error ? error.message : String(error)
        }
      })
    })

  return true
}

const openSidePanelForSelection = (tab?: {
  windowId?: number
  id?: number
}) => {
  if (!isChromiumBased() || !("sidePanel" in browser)) return

  const sidePanel = (browser as unknown as { sidePanel: ChromeSidePanel })
    .sidePanel
  const windowId = tab?.windowId
  const tabId = tab?.id
  if (!windowId || !sidePanel.open) return

  sidePanel.open({ windowId, tabId }).catch((err: unknown) => {
    logger.error("Failed to open sidepanel", "BackgroundSW", {
      error: err instanceof Error ? err.message : String(err)
    })
  })
}

export const handleSelectionMessage = (
  message: ChromeMessage,
  tab: { windowId?: number; id?: number } | undefined,
  sendResponse: SendResponseFunction
): true => {
  if (message.fromBackground) {
    safeSendResponse(sendResponse, { success: true })
    return true
  }

  const selectionText =
    typeof message.payload === "string" ? message.payload.trim() : ""

  if (!selectionText) {
    safeSendResponse(sendResponse, {
      success: false,
      error: {
        status: 400,
        message: "Selection text is required"
      }
    })
    return true
  }

  const pendingSelectionWrite = setPlasmoStoredValue(
    STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT,
    selectionText
  )

  openSidePanelForSelection(tab)

  pendingSelectionWrite
    .then(() => {
      safeSendResponse(sendResponse, { success: true })
      postSelectionToSidePanels(selectionText)

      setTimeout(() => {
        postSelectionToSidePanels(selectionText)
        browser.runtime
          .sendMessage({
            type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
            payload: selectionText,
            fromBackground: true
          })
          .catch((err) => {
            logger.debug(
              "Could not forward selection to chat (sidepanel might be closed)",
              "BackgroundSW",
              { error: err }
            )
          })
      }, 500)
    })
    .catch((error) => {
      safeSendResponse(sendResponse, {
        success: false,
        error: {
          status: 0,
          message: getErrorMessage(error)
        }
      })
    })

  return true
}
