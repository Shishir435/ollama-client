import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { Readability } from "@mozilla/readability"

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT) {
    ;(async () => {
      try {
        const tabAccessEnabled = await plasmoGlobalStorage.get<boolean>(
          STORAGE_KEYS.BROWSER.TABS_ACCESS
        )

        if (!tabAccessEnabled) {
          sendResponse({ html: "❌ Tab access is disabled by the user." })
          return
        }

        const article = new Readability(
          document.cloneNode(true) as Document
        ).parse()

        sendResponse({ html: article?.textContent || "" })
      } catch (err) {
        console.error("Error in content script:", err)
        sendResponse({ html: "❌ Failed to parse content." })
      }
    })()

    return true
  }
})
