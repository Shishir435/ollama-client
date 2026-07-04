import { createErrorResponse } from "@/background/lib/error-handler"
import { safeSendResponse } from "@/background/lib/utils"
import { isChromiumBased } from "@/lib/browser-api"
import { ProviderManager } from "@/lib/providers/manager"
import { ProviderId } from "@/lib/providers/types"
import type { SendResponseFunction } from "@/types"

export const handleUpdateBaseUrl = async (
  payload: string,
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    await ProviderManager.updateProviderConfig(ProviderId.OLLAMA, {
      baseUrl: payload
    })

    if (!isChromiumBased()) {
      safeSendResponse(sendResponse, {
        success: false,
        error: {
          status: 0,
          message:
            "Base URL saved. Firefox still requires manual local provider origin configuration."
        }
      })
      return
    }

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

    safeSendResponse(sendResponse, { success: true })
  } catch (err) {
    safeSendResponse(sendResponse, createErrorResponse(err))
  }
}
