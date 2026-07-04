import { isChromiumBased } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { getBaseUrl } from "./utils"

export const updateDNRRules = async (): Promise<void> => {
  if (!isChromiumBased()) {
    logger.warn(
      "DNR not available: Firefox requires local provider origin configuration",
      "DNR"
    )
    return
  }

  try {
    const baseUrl = await getBaseUrl()
    const origin = new URL(baseUrl).origin

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: "Origin",
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: origin
              }
            ]
          },
          condition: {
            urlFilter: `${origin}/*`,
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST
            ]
          }
        }
      ]
    })
  } catch (error) {
    // Don't throw - allow extension to continue without DNR
    logger.error("Failed to update DNR rules", "DNR", { error })
  }
}
