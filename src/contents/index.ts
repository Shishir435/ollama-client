import { Readability } from "@mozilla/readability"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { getTranscript } from "@/lib/transcript-extractor"
import { normalizeWhitespace } from "@/lib/utils"
import type { ChromeMessage } from "@/types"

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

// Make sure content script is loaded - add to window for debugging
;(
  window as unknown as { __ollamaContentScript?: boolean }
).__ollamaContentScript = true

// Function to initialize YouTube-specific features
const initYouTubeFeatures = () => {
  if (!window.location.href.includes("youtube.com/watch")) return

  // Add visible indicator
  const addIndicator = () => {
    if (document.body) {
      // Remove existing indicator if any
      const existing = document.getElementById(
        "ollama-content-script-indicator"
      )
      if (existing) existing.remove()

      const indicator = document.createElement("div")
      indicator.id = "ollama-content-script-indicator"
      indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #4CAF50;
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 14px;
        z-index: 999999;
        font-family: monospace;
        pointer-events: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      `
      indicator.textContent = ""
      document.body.appendChild(indicator)

      setTimeout(() => {
        indicator.remove()
      }, 5000)
    } else {
      setTimeout(addIndicator, 100)
    }
  }

  addIndicator()

  // Add test function to window for manual testing
  ;(
    window as unknown as {
      __ollamaContentScript?: boolean
      __testTranscript?: () => Promise<void>
    }
  ).__testTranscript = async () => {
    console.log("[Manual Test] Starting manual transcript test...")
    try {
      const { getTranscript } = await import("@/lib/transcript-extractor")
      const transcript = await getTranscript()
      console.log(
        "[Manual Test] Transcript result:",
        transcript ? `${transcript.length} chars` : "null"
      )
      if (transcript) {
        console.log(
          "[Manual Test] First 200 chars:",
          transcript.substring(0, 200)
        )
      }
    } catch (error) {
      console.error("[Manual Test] Error:", error)
    }
  }

  console.log("[Content Script] Manual test: window.__testTranscript()")
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initYouTubeFeatures)
} else {
  initYouTubeFeatures()
}

// Also log for debugging
console.log("[Content Script] Content script loaded")
console.log(`[Content Script] URL: ${window.location.href}`)

browser.runtime.onMessage.addListener(
  (message: ChromeMessage, _sender, sendResponse) => {
    console.log("[Content Script] Message received:", message.type)

    if (message.type === MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT) {
      console.log("[Content Script] Starting GET_PAGE_CONTENT handler")
      ;(async () => {
        try {
          console.log("[Content Script] Checking tab access permission...")
          const tabAccessEnabled = await plasmoGlobalStorage.get<boolean>(
            STORAGE_KEYS.BROWSER.TABS_ACCESS
          )

          if (!tabAccessEnabled) {
            console.log("[Content Script] Tab access is disabled")
            try {
              sendResponse({ html: "Tab access is disabled by the user." })
            } catch {
              // Channel closed - ignore
            }
            return
          }

          const currentUrl = window.location.href
          console.log(`[Content Script] Processing URL: ${currentUrl}`)

          if (await isExcludedUrl(currentUrl)) {
            console.log("[Content Script] URL is excluded")
            try {
              sendResponse({
                html: "This page is excluded by your settings."
              })
            } catch {
              // Channel closed - ignore
            }
            return
          }

          console.log("[Content Script] Parsing article with Readability...")
          const article = new Readability(
            document.cloneNode(true) as Document
          ).parse()

          let readableText = article?.textContent || ""
          readableText = normalizeWhitespace(readableText)
          console.log(
            `[Content Script] Extracted ${readableText.length} chars of readable text`
          )

          console.log("[Content Script] Starting transcript extraction...")
          const transcript = await getTranscript()
          console.log(
            `[Content Script] Transcript extraction completed. Result: ${transcript ? `${transcript.length} chars` : "null"}`
          )

          const finalContent =
            (transcript ? `\n\n Transcript:\n${transcript}` : "") + readableText

          console.log(
            `[Content Script] Sending response with ${finalContent.length} total chars`
          )
          try {
            sendResponse({ html: finalContent })
          } catch {
            // Channel closed - ignore
          }
        } catch (err) {
          console.error("[Content Script] Error in content script:", err)
          try {
            sendResponse({ html: "Failed to parse content." })
          } catch {
            // Channel closed - ignore
          }
        }
      })()

      return true
    }
  }
)
