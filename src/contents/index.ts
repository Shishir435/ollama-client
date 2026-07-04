import type { Runtime } from "webextension-polyfill"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { ChromeMessage } from "@/types"
import {
  clearAgentHighlight,
  executeAgentAction,
  findAgentText,
  highlightAgentTarget,
  scrollAgentPage,
  snapshotPage
} from "./agent-page-runtime"
import { contentDebugLog } from "./content-debug"
import { installContentScriptMarkers, registerYouTubeInit } from "./debug-init"
import { safeSendResponse } from "./message-response"
import { handleGetPageContent } from "./page-content-handler"

installContentScriptMarkers()
registerYouTubeInit()

contentDebugLog("[Content Script] Content script loaded")
contentDebugLog(`[Content Script] URL: ${window.location.href}`)

browser.runtime.onMessage.addListener(((rawMessage, _sender, sendResponse) => {
  const message = rawMessage as ChromeMessage
  contentDebugLog("[Content Script] Message received:", message.type)

  if (message.type === MESSAGE_KEYS.BROWSER.SNAPSHOT_PAGE) {
    safeSendResponse(sendResponse, { success: true, data: snapshotPage() })
    return
  }

  if (message.type === MESSAGE_KEYS.BROWSER.AGENT_CLEAR_HIGHLIGHT) {
    clearAgentHighlight()
    safeSendResponse(sendResponse, { success: true })
    return
  }

  if (
    message.type === MESSAGE_KEYS.BROWSER.AGENT_PAGE_ACTION ||
    message.type === MESSAGE_KEYS.BROWSER.AGENT_HIGHLIGHT ||
    message.type === MESSAGE_KEYS.BROWSER.AGENT_SCROLL ||
    message.type === MESSAGE_KEYS.BROWSER.AGENT_FIND_TEXT
  ) {
    try {
      const payload = (message.payload ?? {}) as Record<string, unknown>
      const data =
        message.type === MESSAGE_KEYS.BROWSER.AGENT_PAGE_ACTION
          ? executeAgentAction(payload as never)
          : message.type === MESSAGE_KEYS.BROWSER.AGENT_HIGHLIGHT
            ? highlightAgentTarget(
                String(payload.snapshotId ?? ""),
                Number(payload.elementId)
              )
            : message.type === MESSAGE_KEYS.BROWSER.AGENT_SCROLL
              ? scrollAgentPage(payload.direction)
              : findAgentText(payload.text)
      safeSendResponse(sendResponse, { success: true, data })
    } catch (error) {
      safeSendResponse(sendResponse, {
        success: false,
        error: {
          status: 400,
          message: error instanceof Error ? error.message : String(error)
        }
      })
    }
    return
  }

  if (message.type !== MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT) return

  contentDebugLog("[Content Script] Starting GET_PAGE_CONTENT handler")
  handleGetPageContent(sendResponse).catch((err) => {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error("Error in content script", "ContentScript", {
      error: err,
      errorMessage
    })
    safeSendResponse(sendResponse, {
      success: false,
      html: `Failed to parse content. Error: ${errorMessage}`,
      title: document.title || "Untitled"
    })
  })

  return true
}) as Runtime.OnMessageListener)
