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
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { getTranscript } from "@/lib/transcript-extractor"
import type { ChromeMessage, ContentExtractionConfig } from "@/types"

import { contentDebugLog } from "./content-debug"
import { extractReadableContent, resolvePageTitle } from "./content-extraction"
import { installContentScriptMarkers, registerYouTubeInit } from "./debug-init"
import {
  detectSiteProfile,
  measureReliability,
  quickHash
} from "./extraction-helpers"
import { isExcludedUrl } from "./url-filter"

installContentScriptMarkers()
registerYouTubeInit()

contentDebugLog("[Content Script] Content script loaded")
contentDebugLog(`[Content Script] URL: ${window.location.href}`)

const resolveActiveConfig = async (
  currentUrl: string
): Promise<{
  effectiveConfig: ContentExtractionConfig
  hasSiteOverride: boolean
}> => {
  const stored = await plasmoGlobalStorage.get<ContentExtractionConfig>(
    STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG
  )

  let excludedUrlPatterns = stored?.excludedUrlPatterns
  if (!excludedUrlPatterns || excludedUrlPatterns.length === 0) {
    const oldPatterns = await plasmoGlobalStorage.get<string[]>(
      STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS
    )
    excludedUrlPatterns =
      oldPatterns || DEFAULT_CONTENT_EXTRACTION_CONFIG.excludedUrlPatterns
  }

  const globalConfig: ContentExtractionConfig = stored
    ? {
        ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
        ...stored,
        excludedUrlPatterns,
        siteOverrides: stored.siteOverrides || {}
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
        return new RegExp(pattern).test(currentUrl)
      } catch {
        return currentUrl.includes(pattern)
      }
    }
  )

  return { effectiveConfig, hasSiteOverride }
}

const safeSendResponse = (
  sendResponse: (response: unknown) => void,
  response: unknown
): void => {
  try {
    sendResponse(response)
  } catch {
    // Channel closed - ignore
  }
}

const isYouTubeWatchPage = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return (
      (parsed.hostname === "youtube.com" ||
        parsed.hostname.endsWith(".youtube.com")) &&
      parsed.pathname === "/watch" &&
      parsed.searchParams.has("v")
    )
  } catch {
    return url.includes("youtube.com/watch?v=")
  }
}

const buildExtractionDebug = ({
  currentUrl,
  pageTitle,
  scraper,
  transcript,
  finalContent,
  extractionResult,
  selectedExtractor,
  selectedReason
}: {
  currentUrl: string
  pageTitle: string
  scraper: string
  transcript: string | null
  finalContent: string
  extractionResult: Awaited<ReturnType<typeof extractContentWithLoading>> | null
  selectedExtractor: string
  selectedReason: string
}) => {
  const profile = detectSiteProfile(currentUrl)
  const contentHash = quickHash(finalContent)
  const capturedAt = Date.now()
  const reliability = measureReliability(finalContent)

  return {
    url: currentUrl,
    title: pageTitle,
    scraper,
    profile,
    hasTranscript: !!transcript,
    transcriptLength: transcript?.length || 0,
    contentLength: finalContent.length,
    contentHash,
    revisionId: `${capturedAt}-${contentHash}`,
    capturedAt,
    reliabilityScore: reliability.reliabilityScore,
    reliabilitySignals: reliability.reliabilitySignals,
    extractionDurationMs: extractionResult?.metrics?.duration,
    scrollSteps: extractionResult?.metrics?.scrollSteps,
    mutationsDetected: extractionResult?.metrics?.mutationsDetected,
    detectedPatterns: extractionResult?.metrics?.detectedPatterns || [],
    selectedExtractor,
    selectedReason,
    filteredSectionCount: 0,
    keptSectionCount: 0,
    effectiveContextLength: finalContent.length,
    preview: finalContent.slice(0, 400)
  }
}

const sendTranscriptOnlyResponse = ({
  sendResponse,
  currentUrl,
  pageTitle,
  transcript,
  platform,
  missingMessage,
  allowMissing = false
}: {
  sendResponse: (response: unknown) => void
  currentUrl: string
  pageTitle: string
  transcript: string | null
  platform: "youtube"
  missingMessage: string
  allowMissing?: boolean
}): boolean => {
  const hasTranscript = !!transcript?.trim()
  const finalContent = hasTranscript ? transcript.trim() : missingMessage

  if (!hasTranscript && !allowMissing) return false

  const extractionDebug = buildExtractionDebug({
    currentUrl,
    pageTitle,
    scraper: `${platform}-transcript`,
    transcript: hasTranscript ? finalContent : null,
    finalContent,
    extractionResult: null,
    selectedExtractor: `${platform}-transcript`,
    selectedReason: `${platform}-transcript-only`
  })

  ;(
    window as unknown as { __lastProviderExtractionResult?: unknown }
  ).__lastProviderExtractionResult = extractionDebug

  safeSendResponse(sendResponse, {
    html: finalContent,
    title: pageTitle,
    extractionDebug
  })

  return true
}

const handleGetPageContent = async (
  sendResponse: (response: unknown) => void
): Promise<void> => {
  const tabAccessEnabled = await plasmoGlobalStorage.get<boolean>(
    STORAGE_KEYS.BROWSER.TABS_ACCESS
  )

  if (!tabAccessEnabled) {
    contentDebugLog("[Content Script] Tab access is disabled")
    safeSendResponse(sendResponse, {
      html: "Tab access is disabled by the user.",
      title: document.title || "Untitled"
    })
    return
  }

  const currentUrl = window.location.href
  contentDebugLog(`[Content Script] Processing URL: ${currentUrl}`)
  const youtubeWatchPage = isYouTubeWatchPage(currentUrl)

  if (await isExcludedUrl(currentUrl)) {
    contentDebugLog("[Content Script] URL is excluded")
    safeSendResponse(sendResponse, {
      html: "This page is excluded by your settings.",
      title: document.title || "Untitled"
    })
    return
  }

  const { effectiveConfig, hasSiteOverride } =
    await resolveActiveConfig(currentUrl)

  contentDebugLog("[Content Script] Using config:", {
    enabled: effectiveConfig.enabled,
    scrollStrategy: effectiveConfig.scrollStrategy,
    scrollDepth: `${(effectiveConfig.scrollDepth * 100).toFixed(0)}%`,
    site: hasSiteOverride ? "Custom site config" : "Global config"
  })

  if (youtubeWatchPage) {
    logger.info(
      "YouTube watch page detected; extracting title and transcript only",
      "ContentScript",
      { url: currentUrl }
    )
    const pageTitle = resolvePageTitle(document, "")
    const transcript = await getTranscript()

    if (!transcript?.trim()) {
      logger.warn("YouTube transcript extraction failed", "ContentScript", {
        url: currentUrl,
        transcriptLength: transcript?.length || 0
      })
    }

    sendTranscriptOnlyResponse({
      sendResponse,
      currentUrl,
      pageTitle,
      transcript,
      platform: "youtube",
      missingMessage: "No transcript found for this YouTube video.",
      allowMissing: true
    })
    return
  }

  let extractionResult: Awaited<
    ReturnType<typeof extractContentWithLoading>
  > | null = null
  if (effectiveConfig.enabled) {
    contentDebugLog("[Content Script] Starting enhanced content extraction...")
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
      logger.warn(
        "Enhanced extraction failed, falling back to basic extraction",
        "ContentScript",
        { error }
      )
    }
  }

  const scraper = effectiveConfig.contentScraper || "auto"
  contentDebugLog(`[Content Script] Using scraper: ${scraper}`)

  const readable = extractReadableContent(document, scraper)
  const pageTitle = resolvePageTitle(document, readable.pageTitle)

  contentDebugLog(`[Content Script] Extracted title: "${pageTitle}"`)
  contentDebugLog(
    `[Content Script] Extracted ${readable.readableText.length} chars of readable text via ${readable.selectedExtractor}`
  )

  contentDebugLog("[Content Script] Starting transcript extraction...")
  const transcript = await getTranscript()
  contentDebugLog(
    `[Content Script] Transcript extraction completed. Result: ${transcript ? `${transcript.length} chars` : "null"}`
  )

  const finalContent =
    (transcript ? `\n\n Transcript:\n${transcript}` : "") +
    readable.readableText

  if (!finalContent || finalContent.trim().length < 50) {
    logger.error(
      `Extraction failed: Only ${finalContent?.length || 0} chars extracted`,
      "ContentScript"
    )
    throw new Error(
      `Failed to extract meaningful content (only ${finalContent?.length || 0} chars). URL: ${currentUrl}`
    )
  }

  const extractionDebug = buildExtractionDebug({
    currentUrl,
    pageTitle,
    scraper,
    transcript,
    finalContent,
    extractionResult,
    selectedExtractor: readable.selectedExtractor,
    selectedReason: readable.selectedReason
  })

  ;(
    window as unknown as { __lastProviderExtractionResult?: unknown }
  ).__lastProviderExtractionResult = extractionDebug

  safeSendResponse(sendResponse, {
    html: finalContent,
    title: pageTitle,
    extractionDebug
  })
}

browser.runtime.onMessage.addListener(
  (message: ChromeMessage, _sender, sendResponse) => {
    contentDebugLog("[Content Script] Message received:", message.type)

    if (message.type !== MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT) return

    contentDebugLog("[Content Script] Starting GET_PAGE_CONTENT handler")
    handleGetPageContent(sendResponse).catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err)
      logger.error("Error in content script", "ContentScript", {
        error: err,
        errorMessage
      })
      safeSendResponse(sendResponse, {
        html: `Failed to parse content. Error: ${errorMessage}`,
        title: document.title || "Untitled"
      })
    })

    return true
  }
)
