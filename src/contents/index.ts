import { Readability } from "@mozilla/readability"
import Defuddle from "defuddle"

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

const extractContent = async (): Promise<{ html: string; source: string }> => {
  const extractors = [
    {
      name: "defuddle",
      run: () => {
        const defuddle = new Defuddle(document)
        const result = defuddle.parse()
        return result?.content || null
      }
    },
    {
      name: "readability",
      run: () => {
        const article = new Readability(
          document.cloneNode(true) as Document
        ).parse()
        return article?.textContent || null
      }
    },
    {
      name: "basic-fallback",
      run: () => {
        const bodyText = Array.from(document.querySelectorAll("p, div"))
          .map((el) => el.textContent)
          .filter(Boolean)
          .join("\n\n")
        return bodyText || null
      }
    }
  ]

  for (const extractor of extractors) {
    try {
      const content = extractor.run()
      if (content) {
        const transcript = getTranscript()
        const finalText = normalizeWhitespace(
          (transcript ? `\n\nTranscript:\n${transcript}` : "") + content
        )
        return { html: finalText, source: extractor.name }
      }
    } catch (e) {
      console.warn(`${extractor.name} extractor failed`, e)
    }
  }

  return { html: "❌ Failed to extract any content.", source: "none" }
}

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

        const currentUrl = window.location.href

        if (await isExcludedUrl(currentUrl)) {
          sendResponse({ html: "❌ This page is excluded by your settings." })
          return
        }

        const { html, source } = await extractContent()
        sendResponse({ html, source })
      } catch (err) {
        console.error("Error in content script:", err)
        sendResponse({ html: "❌ Failed to parse content." })
      }
    })()

    return true
  }
})
