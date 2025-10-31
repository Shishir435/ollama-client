import { isChromiumBased } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const updateDNRRules = async (): Promise<void> => {
  if (!isChromiumBased()) {
    console.warn(
      "DNR not available: Firefox requires OLLAMA_ORIGINS configuration"
    )
    return
  }

  try {
    const baseUrl =
      ((await plasmoGlobalStorage.get(
        STORAGE_KEYS.OLLAMA.BASE_URL
      )) as string) ?? "http://localhost:11434"

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
    console.error("Failed to update DNR rules:", error)
  }
}
