import type { Runtime } from "webextension-polyfill"
import { openSidePanelDuringGesture } from "@/background/handlers/handle-context-menu"
import { safeSendResponse } from "@/background/lib/runtime-delivery"
import { postSelectionToSidePanels } from "@/background/lib/selection-bridge"
import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { getErrorMessage } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { setPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import { addSession, deleteSessionRow } from "@/lib/repositories/chat-history"
import { SELECTION_ACTION_SETTINGS } from "@/lib/storage/selection-action-settings"
import { readSetting } from "@/lib/storage/setting-access"
import {
  isSelectionOverlayLoadRequest,
  SELECTION_OVERLAY_REQUEST_ID_GLOBAL,
  type SelectionOverlayLoadResult
} from "@/protocol/content-messages"
import {
  SelectionChatRequestSchema,
  type SelectionChatHandoff
} from "@/protocol/selection-handoff"
import type { ChromeMessage, SendResponseFunction } from "@/types"

const SELECTION_OVERLAY_FILE = "content-scripts/selection-overlay.js"

const setSelectionOverlayRequestId = (key: string, requestId: string) => {
  Reflect.set(globalThis, key, requestId)
}

class SelectionActionsDisabledError extends Error {
  constructor() {
    super("Selection actions are turned off")
  }
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
  /*
   * The page-side script asks on every selection, and the overlay it would
   * inject is 743 KB with its own listeners and heap in every tab. The setting
   * has to be read here, where the cost is still avoidable.
   */
  readSetting(SELECTION_ACTION_SETTINGS.CONTENT_EXTRACTION_CONFIG)
    .then((config) => {
      if (config?.selectionActionsEnabled === false)
        throw new SelectionActionsDisabledError()
      return browser.scripting.executeScript({
        target,
        func: setSelectionOverlayRequestId,
        args: [SELECTION_OVERLAY_REQUEST_ID_GLOBAL, payload.requestId]
      })
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

/** Stage a selection during the opening gesture, rolling back an unpublished new chat on failure. */
export const handleSelectionMessage = (
  message: ChromeMessage,
  tab: { windowId?: number; id?: number } | undefined,
  sendResponse: SendResponseFunction
): true => {
  if (message.fromBackground) {
    safeSendResponse(sendResponse, { success: true })
    return true
  }

  const parsed = SelectionChatRequestSchema.safeParse(message.payload)

  if (!parsed.success) {
    safeSendResponse(sendResponse, {
      success: false,
      error: {
        status: 400,
        message: "Selection text is required"
      }
    })
    return true
  }

  const request = parsed.data
  /** A pending handoff must never point at a session that failed to persist. */
  const stageSelection = async (): Promise<SelectionChatHandoff> => {
    const handoff: SelectionChatHandoff =
      typeof request === "string"
        ? request
        : {
            text: request.text,
            sessionId: crypto.randomUUID(),
            ...(typeof tab?.windowId === "number" && { windowId: tab.windowId })
          }
    if (typeof handoff !== "string") {
      const now = Date.now()
      await addSession({
        id: handoff.sessionId,
        title: "New Chat",
        createdAt: now,
        updatedAt: now,
        messages: []
      })
    }
    try {
      await setPlasmoStoredValue(
        STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT,
        handoff
      )
    } catch (error) {
      if (typeof handoff !== "string") {
        await deleteSessionRow(handoff.sessionId).catch(
          (cleanupError: unknown) => {
            logger.warn(
              "Could not remove unstaged selection chat",
              "SelectionHandoff",
              { error: getErrorMessage(cleanupError) }
            )
          }
        )
      }
      throw error
    }
    return handoff
  }

  openSidePanelDuringGesture(tab)

  stageSelection()
    .then((selectionText) => {
      safeSendResponse(sendResponse, { success: true })
      postSelectionToSidePanels(selectionText)
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
