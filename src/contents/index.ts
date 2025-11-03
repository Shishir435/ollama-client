import { Readability } from "@mozilla/readability"
import Defuddle from "defuddle"

import { browser } from "@/lib/browser-api"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import {
  extractContentWithLoading,
  getEffectiveConfig
} from "@/lib/content-extractor"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { getTranscript } from "@/lib/transcript-extractor"
import { normalizeWhitespaceForLLM } from "@/lib/utils"
import type { ChromeMessage, ContentExtractionConfig } from "@/types"

const isExcludedUrl = async (url: string): Promise<boolean> => {
  // Try to get patterns from new config first
  const storedConfig = await plasmoGlobalStorage.get<ContentExtractionConfig>(
    STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG
  )

  let patterns: string[] | undefined

  if (storedConfig?.excludedUrlPatterns) {
    // Use patterns from new config
    patterns = storedConfig.excludedUrlPatterns
  } else {
    // Fallback to old storage key for backward compatibility
    patterns = await plasmoGlobalStorage.get<string[]>(
      STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS
    )
  }

  // If still no patterns, use defaults
  if (!patterns || patterns.length === 0) {
    patterns = DEFAULT_CONTENT_EXTRACTION_CONFIG.excludedUrlPatterns
  }

  return (
    patterns.some((pattern) => {
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
      __testExtraction?: () => Promise<void>
      __getExtractionLogs?: () => unknown[]
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

  // Add test function for content extraction
  ;(
    window as unknown as {
      __ollamaContentScript?: boolean
      __testTranscript?: () => Promise<void>
      __testExtraction?: () => Promise<void>
      __getExtractionLogs?: () => unknown[]
    }
  ).__testExtraction = async () => {
    console.log("[Manual Test] Starting manual extraction test...")
    try {
      const { extractContentWithLoading } = await import(
        "@/lib/content-extractor"
      )
      const { DEFAULT_CONTENT_EXTRACTION_CONFIG } = await import(
        "@/lib/constants"
      )
      const result = await extractContentWithLoading(
        DEFAULT_CONTENT_EXTRACTION_CONFIG
      )
      console.log("[Manual Test] Extraction result:", result.metrics)
      console.log(
        "[Manual Test] Detected patterns:",
        result.logEntry.detectedPatterns
      )
    } catch (error) {
      console.error("[Manual Test] Error:", error)
    }
  }

  // Add function to get extraction logs for feedback
  ;(
    window as unknown as {
      __ollamaContentScript?: boolean
      __testTranscript?: () => Promise<void>
      __testExtraction?: () => Promise<void>
      __getExtractionLogs?: () => unknown[]
    }
  ).__getExtractionLogs = () => {
    const logs =
      (window as unknown as { __ollamaExtractionLogs?: unknown[] })
        .__ollamaExtractionLogs || []
    console.log("[Content Script] Extraction logs:", logs)
    return logs
  }

  console.log("[Content Script] Manual tests:")
  console.log("  - window.__testTranscript() - Test transcript extraction")
  console.log("  - window.__testExtraction() - Test content extraction")
  console.log(
    "  - window.__getExtractionLogs() - Get extraction logs for feedback"
  )
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
              sendResponse({
                html: "Tab access is disabled by the user.",
                title: document.title || "Untitled"
              })
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
                html: "This page is excluded by your settings.",
                title: document.title || "Untitled"
              })
            } catch {
              // Channel closed - ignore
            }
            return
          }

          // Get content extraction configuration
          const storedConfig =
            await plasmoGlobalStorage.get<ContentExtractionConfig>(
              STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG
            )

          // Migrate excludedUrlPatterns from old storage if not in new config
          let excludedUrlPatterns = storedConfig?.excludedUrlPatterns
          if (!excludedUrlPatterns || excludedUrlPatterns.length === 0) {
            const oldPatterns = await plasmoGlobalStorage.get<string[]>(
              STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS
            )
            excludedUrlPatterns =
              oldPatterns ||
              DEFAULT_CONTENT_EXTRACTION_CONFIG.excludedUrlPatterns
          }

          const globalConfig: ContentExtractionConfig = storedConfig
            ? {
                ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
                ...storedConfig,
                excludedUrlPatterns,
                siteOverrides: storedConfig.siteOverrides || {}
              }
            : {
                ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
                excludedUrlPatterns
              }

          const effectiveConfig = getEffectiveConfig(
            currentUrl,
            globalConfig,
            DEFAULT_CONTENT_EXTRACTION_CONFIG
          )

          const hasSiteOverride = Object.keys(globalConfig.siteOverrides).some(
            (pattern) => {
              try {
                const regex = new RegExp(pattern)
                return regex.test(currentUrl)
              } catch {
                return currentUrl.includes(pattern)
              }
            }
          )

          console.log("[Content Script] Using config:", {
            enabled: effectiveConfig.enabled,
            scrollStrategy: effectiveConfig.scrollStrategy,
            scrollDepth: `${(effectiveConfig.scrollDepth * 100).toFixed(0)}%`,
            site: hasSiteOverride ? "Custom site config" : "Global config"
          })

          // Enhanced content extraction with lazy loading support
          let extractionResult: Awaited<
            ReturnType<typeof extractContentWithLoading>
          > | null = null
          if (effectiveConfig.enabled) {
            console.log(
              "[Content Script] Starting enhanced content extraction..."
            )
            try {
              extractionResult = await Promise.race([
                extractContentWithLoading(effectiveConfig),
                new Promise<never>((_, reject) =>
                  setTimeout(
                    () => reject(new Error("Extraction timeout")),
                    effectiveConfig.maxWaitTime
                  )
                )
              ])
            } catch (error) {
              console.warn(
                "[Content Script] Enhanced extraction failed, falling back to basic extraction:",
                error
              )
              extractionResult = null
            }
          }

          // Parse with defuddle first (better GitHub support, more tokens)
          console.log("[Content Script] Parsing article with defuddle...")
          let readableText = ""
          let pageTitle = ""
          let defuddleResult: ReturnType<Defuddle["parse"]> | null = null

          try {
            const defuddle = new Defuddle(document, {
              markdown: true,
              separateMarkdown: false,
              removeExactSelectors: true // Remove ads and social buttons
            })
            defuddleResult = defuddle.parse()

            // Prefer markdown if available, otherwise use HTML content
            readableText =
              defuddleResult?.contentMarkdown || defuddleResult?.content || ""
            readableText = normalizeWhitespaceForLLM(readableText)
            pageTitle = defuddleResult?.title || ""

            console.log(
              `[Content Script] defuddle extracted ${readableText.length} chars (${defuddleResult?.contentMarkdown ? "markdown" : "HTML"})`
            )
          } catch (error) {
            console.warn(
              "[Content Script] defuddle failed, falling back to Readability:",
              error
            )
          }

          // Fallback to Readability if defuddle failed or returned minimal content
          if (!readableText || readableText.trim().length < 100) {
            console.log(
              "[Content Script] defuddle returned minimal content, trying Readability..."
            )
            try {
              const article = new Readability(
                document.cloneNode(true) as Document
              ).parse()

              const readabilityText = article?.textContent || ""
              const normalizedReadability =
                normalizeWhitespaceForLLM(readabilityText)

              // Use Readability result if it's better than defuddle
              if (
                normalizedReadability.length > readableText.length ||
                readableText.trim().length < 50
              ) {
                readableText = normalizedReadability
                console.log(
                  `[Content Script] Readability extracted ${readableText.length} chars`
                )
              }

              // Use Readability title if defuddle didn't provide one
              if (!pageTitle && article?.title) {
                pageTitle = article.title
              }
            } catch (error) {
              console.error(
                "[Content Script] Readability fallback failed:",
                error
              )
            }
          }

          // Final fallback: if still no content, try basic text extraction
          if (!readableText || readableText.trim().length < 50) {
            console.log(
              "[Content Script] Trying basic text extraction as final fallback..."
            )
            const bodyText = document.body?.textContent || ""
            const normalizedBody = normalizeWhitespaceForLLM(bodyText)
            // Remove very short content (likely navigation/UI noise)
            if (normalizedBody.length > 200) {
              readableText = normalizedBody
              console.log(
                `[Content Script] Basic extraction successful: ${readableText.length} chars`
              )
            }
          }

          // Extract title with fallbacks (if not already set from defuddle)
          if (!pageTitle) {
            // Try meta tags first
            const ogTitle = document
              .querySelector('meta[property="og:title"]')
              ?.getAttribute("content")
            const twitterTitle = document
              .querySelector('meta[name="twitter:title"]')
              ?.getAttribute("content")
            const metaTitle = document
              .querySelector('meta[name="title"]')
              ?.getAttribute("content")

            pageTitle =
              ogTitle || twitterTitle || metaTitle || document.title || ""
          }

          // Clean up title - remove common suffixes and "Untitled" generic titles
          if (
            pageTitle &&
            !pageTitle.toLowerCase().includes("untitled") &&
            pageTitle.trim().length > 0
          ) {
            pageTitle = pageTitle
              .replace(/\s*[-|]\s*.*$/, "") // Remove " - Site Name" suffix
              .replace(/\s*:\s*.*$/, "") // Remove " : Category" suffix
              .trim()
          } else {
            // Final fallback to document.title
            pageTitle = document.title || "Untitled"
          }

          console.log(`[Content Script] Extracted title: "${pageTitle}"`)

          // Log extraction metrics if available
          if (extractionResult) {
            const { metrics } = extractionResult
            console.log("[Content Script] Extraction metrics:", {
              duration: `${metrics.duration}ms`,
              scrollSteps: metrics.scrollSteps,
              mutationsDetected: metrics.mutationsDetected,
              detectedPatterns: metrics.detectedPatterns,
              finalContentLength: readableText.length
            })

            // Log entry is already stored in window.__ollamaExtractionLogs for feedback
            console.log(
              "[Content Script] Extraction log available via window.__ollamaExtractionLogs"
            )
          }

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

          // Final validation: ensure we have meaningful content
          if (!finalContent || finalContent.trim().length < 50) {
            console.error(
              `[Content Script] Extraction failed: Only ${finalContent?.length || 0} chars extracted`
            )
            throw new Error(
              `Failed to extract meaningful content (only ${finalContent?.length || 0} chars). URL: ${currentUrl}`
            )
          }

          console.log(
            `[Content Script] Sending response with ${finalContent.length} total chars`
          )
          try {
            sendResponse({
              html: finalContent,
              title: pageTitle || document.title || "Untitled"
            })
          } catch {
            // Channel closed - ignore
          }
        } catch (err) {
          console.error("[Content Script] Error in content script:", err)
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error("[Content Script] Error details:", errorMessage)
          try {
            sendResponse({
              html: `Failed to parse content. Error: ${errorMessage}`,
              title: document.title || "Untitled"
            })
          } catch {
            // Channel closed - ignore
          }
        }
      })()

      return true
    }
  }
)
