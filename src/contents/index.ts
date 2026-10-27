import type { Runtime } from "webextension-polyfill"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { ChromeMessage } from "@/types"
import { contentDebugLog } from "./content-debug"
import { installContentScriptMarkers, registerYouTubeInit } from "./debug-init"
import { safeSendResponse } from "./message-response"
import {
  EmptyPageContentError,
  handleGetPageContent,
  type PageContentFailureReason
} from "./page-content-handler"

/**
 * The extractor is injected into every frame to reach embedded documents, which
 * also re-runs it in a frame that already has it. A second listener would race
 * the first for the same reply.
 */
const alreadyLoaded = Boolean(
  (window as unknown as { __providerContentScript?: boolean })
    .__providerContentScript
)

installContentScriptMarkers()
registerYouTubeInit()

contentDebugLog("[Content Script] Content script loaded")
contentDebugLog(`[Content Script] URL: ${window.location.href}`)

if (!alreadyLoaded)
  browser.runtime.onMessage.addListener(((
    rawMessage,
    _sender,
    sendResponse
  ) => {
    const message = rawMessage as ChromeMessage
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
        reason: (err instanceof EmptyPageContentError
          ? "empty"
          : "error") satisfies PageContentFailureReason,
        html: `Failed to parse content. Error: ${errorMessage}`,
        title: document.title || "Untitled"
      })
    })

    return true
  }) as Runtime.OnMessageListener)
