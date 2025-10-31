import { isChromiumBased } from "@/lib/browser-api"
import type { SendResponseFunction } from "@/types"

export const handleUpdateBaseUrl = async (
  payload: string,
  sendResponse: SendResponseFunction
): Promise<void> => {
  if (!isChromiumBased()) {
    sendResponse({
      success: false,
      error: {
        status: 0,
        message:
          "Firefox requires manual OLLAMA_ORIGINS configuration. See settings for instructions."
      }
    })
    return
  }

  try {
    const origin = new URL(payload).origin

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

    sendResponse({ success: true })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
