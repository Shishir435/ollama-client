/**
 * Window markers and YouTube-specific debug helpers for the content script.
 *
 * These are non-critical: they let dev tools and the extension's own
 * debugging surface detect that the script is loaded and offer ad-hoc
 * test entry points. They never affect user-facing behavior.
 */

import { contentDebugLog } from "./content-debug"

interface ContentScriptWindow extends Window {
  __providerContentScript?: boolean
  __ollamaContentScript?: boolean
  __testTranscript?: () => Promise<void>
  __testExtraction?: () => Promise<void>
  __getExtractionLogs?: () => unknown[]
  __lastProviderExtractionResult?: unknown
  __providerExtractionLogs?: unknown[]
  __ollamaExtractionLogs?: unknown[]
}

const w = () => window as unknown as ContentScriptWindow

/** Set window markers used by debug tooling. Safe to call multiple times. */
export const installContentScriptMarkers = (): void => {
  w().__providerContentScript = true
  // Legacy marker for older debug tooling.
  w().__ollamaContentScript = true
}

const addYouTubeIndicator = (): void => {
  if (!document.body) {
    setTimeout(addYouTubeIndicator, 100)
    return
  }

  const existing =
    document.getElementById("provider-content-script-indicator") ||
    document.getElementById("ollama-content-script-indicator")
  existing?.remove()

  const indicator = document.createElement("div")
  indicator.id = "provider-content-script-indicator"
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

  setTimeout(() => indicator.remove(), 5000)
}

const installDebugHelpers = (): void => {
  w().__testTranscript = async () => {
    contentDebugLog("[Manual Test] Starting manual transcript test...")
    try {
      const { getTranscript } = await import("@/lib/transcript-extractor")
      const transcript = await getTranscript()
      contentDebugLog(
        "[Manual Test] Transcript result:",
        transcript ? `${transcript.length} chars` : "null"
      )
      if (transcript) {
        contentDebugLog(
          "[Manual Test] First 200 chars:",
          transcript.substring(0, 200)
        )
      }
    } catch (error) {
      console.error("[Manual Test] Error:", error)
    }
  }

  w().__testExtraction = async () => {
    contentDebugLog("[Manual Test] Starting manual extraction test...")
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
      contentDebugLog("[Manual Test] Extraction result:", result.metrics)
      contentDebugLog(
        "[Manual Test] Detected patterns:",
        result.logEntry.detectedPatterns
      )
    } catch (error) {
      console.error("[Manual Test] Error:", error)
    }
  }

  w().__getExtractionLogs = () => {
    const logs =
      w().__providerExtractionLogs || w().__ollamaExtractionLogs || []
    contentDebugLog("[Content Script] Extraction logs:", logs)
    return logs
  }
}

/**
 * Initialize YouTube-only features: a temporary green indicator badge and a
 * trio of `window.__testXxx` console helpers. Idempotent.
 */
export const initYouTubeFeatures = (): void => {
  if (!window.location.href.includes("youtube.com/watch")) return

  addYouTubeIndicator()
  installDebugHelpers()

  contentDebugLog("[Content Script] Manual tests:")
  contentDebugLog("  - window.__testTranscript() - Test transcript extraction")
  contentDebugLog("  - window.__testExtraction() - Test content extraction")
  contentDebugLog(
    "  - window.__getExtractionLogs() - Get extraction logs for feedback"
  )
}

/** Register the YouTube-feature init for the next paint or DOMContentLoaded. */
export const registerYouTubeInit = (): void => {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initYouTubeFeatures)
  } else {
    initYouTubeFeatures()
  }
}
