import { Readability } from "@mozilla/readability"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { getTranscript } from "@/lib/transcript-extractor"
import { normalizeWhitespace } from "@/lib/utils"

const isExcludedUrl = async (url: string): Promise<boolean> => {
  const patterns = await plasmoGlobalStorage.get<string[]>(
    STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS
  )

  return (
    patterns?.some((pattern) => {
      try {
        return new RegExp(pattern).test(url)
      } catch {
        return url.includes(pattern)
      }
    }) ?? false
  )
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT) {
    ;(async () => {
      try {
        const tabAccessEnabled = await plasmoGlobalStorage.get<boolean>(
          STORAGE_KEYS.BROWSER.TABS_ACCESS
        )

        if (!tabAccessEnabled) {
          try {
            sendResponse({ html: "❌ Tab access is disabled by the user." })
          } catch {
            // Channel closed - ignore
          }
          return
        }

        const currentUrl = window.location.href

        if (await isExcludedUrl(currentUrl)) {
          try {
            sendResponse({
              html: "❌ This page is excluded by your settings."
            })
          } catch {
            // Channel closed - ignore
          }
          return
        }

        const article = new Readability(
          document.cloneNode(true) as Document
        ).parse()

        let readableText = article?.textContent || ""
        readableText = normalizeWhitespace(readableText)
        const transcript = getTranscript()
        const finalContent =
          (transcript ? `\n\n Transcript:\n${transcript}` : "") + readableText

        try {
          sendResponse({ html: finalContent })
        } catch {
          // Channel closed - ignore
        }
      } catch (err) {
        console.error("Error in content script:", err)
        try {
          sendResponse({ html: "❌ Failed to parse content." })
        } catch {
          // Channel closed - ignore
        }
      }
    })()

    return true
  }
})
