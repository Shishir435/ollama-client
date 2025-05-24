import { MESSAGE_KEYS } from "@/lib/constant"
import { Readability } from "@mozilla/readability"

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT) {
    try {
      const article = new Readability(
        document.cloneNode(true) as Document
      ).parse()
      sendResponse({ html: article?.textContent || "" })
    } catch (err) {
      console.log(err)
      sendResponse({ html: "Failed to parse content." })
    }
    return true
  }
})
