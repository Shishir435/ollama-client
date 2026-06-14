import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { ChromeMessage } from "@/types"

import { contentDebugLog } from "./content-debug"
import { installContentScriptMarkers, registerYouTubeInit } from "./debug-init"
import { safeSendResponse } from "./message-response"
import { handleGetPageContent } from "./page-content-handler"

installContentScriptMarkers()
registerYouTubeInit()

contentDebugLog("[Content Script] Content script loaded")
contentDebugLog(`[Content Script] URL: ${window.location.href}`)

browser.runtime.onMessage.addListener(
  (message: ChromeMessage, _sender, sendResponse) => {
    contentDebugLog("[Content Script] Message received:", message.type)

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
  }
)
