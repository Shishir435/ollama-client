import { safeSendResponse } from "@/background/lib/utils"
import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import type { SendResponseFunction } from "@/types"

export const handleOpenTabs = (sendResponse: SendResponseFunction): true => {
  browser.tabs
    .query({})
    .then((tabs) => {
      logger.info("Queried browser tabs", "BackgroundSW", {
        tabCount: tabs.length
      })
      safeSendResponse(sendResponse, { success: true, tabs })
    })
    .catch((error: unknown) => {
      logger.error("Failed to query browser tabs", "BackgroundSW", { error })
      safeSendResponse(sendResponse, {
        success: false,
        error: {
          status: 0,
          message:
            error instanceof Error ? error.message : "Failed to query tabs"
        }
      })
    })
  return true
}
