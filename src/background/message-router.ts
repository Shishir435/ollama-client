import type { Runtime } from "webextension-polyfill"
import { handleGetModels } from "@/background/handlers/handle-get-models"
import { notifyJobComplete } from "@/background/lib/notify"
import { postSelectionToSidePanels } from "@/background/lib/selection-bridge"
import { resolveToolConfirmation } from "@/background/lib/tool-confirmation-registry"
import { safeSendResponse } from "@/background/lib/utils"
import {
  handleRpcCancellation,
  handleRpcRequest
} from "@/background/rpc-server"
import {
  classifyRuntimeSender,
  isRuntimeMessageAllowed
} from "@/background/runtime-sender-authorization"
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
import {
  RPC_CANCEL_MESSAGE_TYPE,
  RPC_REQUEST_MESSAGE_TYPE
} from "@/protocol/rpc"
import type {
  ChromeMessage,
  ChromeSidePanel,
  SendResponseFunction
} from "@/types"

const extensionUrlPrefix = browser.runtime.getURL("")
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

const respondForbidden = (
  type: string,
  sender: Runtime.MessageSender,
  sendResponse: SendResponseFunction
) => {
  logger.warn("Blocked unauthorized runtime message", "RuntimeAuthorization", {
    type,
    surface: classifyRuntimeSender(
      sender,
      browser.runtime.id,
      extensionUrlPrefix
    ),
    tabId: sender.tab?.id
  })
  safeSendResponse(sendResponse, {
    success: false,
    error: { status: 403, message: "Message not allowed from this context" }
  })
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

const handleSelectionMessage = (
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

export const registerMessageRouter = () => {
  // The polyfill types the sync listener as returning literal `true`, but we use
  // the Chrome idiom of returning `true` only for handled async responses and
  // falling through (undefined) for messages meant for other listeners. Cast to
  // reconcile that mismatch without changing the runtime contract.
  browser.runtime.onMessage.addListener(((
    rawMessage,
    sender,
    sendResponse
  ): true | undefined => {
    const response = sendResponse as SendResponseFunction
    const message = rawMessage as ChromeMessage

    if (
      typeof message?.type !== "string" ||
      !isRuntimeMessageAllowed(
        message.type,
        sender,
        browser.runtime.id,
        extensionUrlPrefix
      )
    ) {
      respondForbidden(
        typeof message?.type === "string" ? message.type : "invalid",
        sender,
        response
      )
      return true
    }

    switch (message.type) {
      case RPC_CANCEL_MESSAGE_TYPE: {
        handleRpcCancellation(
          rawMessage,
          sender,
          browser.runtime.id,
          extensionUrlPrefix,
          sendResponse
        )
        return true
      }

      case RPC_REQUEST_MESSAGE_TYPE: {
        handleRpcRequest(
          rawMessage,
          sender,
          browser.runtime.id,
          extensionUrlPrefix,
          sendResponse
        )
        return true
      }

      /*
       * The last provider-domain runtime message, kept because its only caller
       * is the selection overlay's content script. The RPC envelope is
       * deliberately extension-page-only (plan section 4.13: never trust a
       * content script), so this narrow, allowlisted read stays a plain
       * message rather than opening the protocol to page contexts.
       */
      case MESSAGE_KEYS.PROVIDER.GET_MODELS: {
        handleGetModels(response)
        return true
      }

      case MESSAGE_KEYS.BROWSER.OPEN_TAB: {
        browser.tabs
          .query({})
          .then((tabs) => {
            logger.info("Queried browser tabs", "BackgroundSW", {
              tabCount: tabs.length
            })
            safeSendResponse(response, { success: true, tabs })
          })
          .catch((error: unknown) => {
            logger.error("Failed to query browser tabs", "BackgroundSW", {
              error
            })
            safeSendResponse(response, {
              success: false,
              error: {
                status: 0,
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to query tabs"
              }
            })
          })
        return true
      }

      case MESSAGE_KEYS.APP.KEEP_TOOL_LOOP_ALIVE: {
        // A visible approval prompt sends this periodically. Runtime messages
        // reset Chromium's MV3 idle timer without adding a standing `alarms`
        // permission; SQLite recovery remains the crash/restart fallback.
        safeSendResponse(response, { success: true })
        return
      }

      case MESSAGE_KEYS.APP.NOTIFY_JOB_COMPLETE: {
        const payload = message.payload as
          | { id?: string; title?: unknown; message?: unknown }
          | undefined
        if (
          !payload ||
          typeof payload.title !== "string" ||
          typeof payload.message !== "string"
        ) {
          safeSendResponse(response, {
            success: false,
            error: { status: 400, message: "Invalid message payload" }
          })
          return true
        }

        notifyJobComplete({
          id: typeof payload.id === "string" ? payload.id : undefined,
          title: payload.title,
          message: payload.message
        })
          .then((result) => {
            safeSendResponse(response, {
              success: result.sent,
              data: result,
              error: result.sent
                ? undefined
                : {
                    status: 0,
                    message: result.reason || "Notification skipped"
                  }
            })
          })
          .catch((error) => {
            safeSendResponse(response, {
              success: false,
              error: {
                status: 0,
                message: error instanceof Error ? error.message : String(error)
              }
            })
          })
        return true
      }

      case MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT: {
        return handleSelectionMessage(message, sender.tab, response)
      }

      case MESSAGE_KEYS.BROWSER.LOAD_SELECTION_OVERLAY: {
        return handleLoadSelectionOverlay(message.payload, sender, response)
      }

      case MESSAGE_KEYS.PROVIDER.CONFIRM_TOOL: {
        const payload = message.payload as
          | { callId?: unknown; approved?: unknown; scope?: unknown }
          | undefined
        const valid = typeof payload?.callId === "string"
        if (valid) {
          const scope =
            payload?.scope === "session" || payload?.scope === "always"
              ? payload.scope
              : undefined
          resolveToolConfirmation(
            payload.callId as string,
            payload?.approved === true,
            scope
          )
        }
        // Respond synchronously — returning true without ever calling
        // sendResponse makes the sender's promise reject with "The message
        // port closed before a response was received."
        safeSendResponse(response, { success: valid })
        return
      }
    }
  }) as Runtime.OnMessageListener)
}
