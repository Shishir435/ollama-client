import { DEFAULT_TABS_ACCESS, STORAGE_KEYS } from "@/lib/constants"
import { extractContentWithLoading } from "@/lib/content-extractor"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { getTranscript } from "@/lib/transcript-extractor"
import { resolveActiveConfig } from "./content-config"
import { contentDebugLog } from "./content-debug"
import { extractReadableContent, resolvePageTitle } from "./content-extraction"
import {
  buildExtractionDebug,
  sendTranscriptOnlyResponse
} from "./extraction-debug"
import { safeSendResponse } from "./message-response"
import { isUdemyLecturePage, isYouTubeWatchPage } from "./page-platforms"
import { isExcludedUrl } from "./url-filter"

const normalizeText = (value: string | null | undefined): string =>
  value?.replace(/\s+/g, " ").trim() || ""

const firstText = (selectors: string[]): string => {
  for (const selector of selectors) {
    const value = normalizeText(
      document.querySelector<HTMLElement>(selector)?.textContent
    )
    if (value) return value
  }
  return ""
}

const firstAttribute = (selectors: string[], attribute: string): string => {
  for (const selector of selectors) {
    const value = normalizeText(
      document.querySelector<HTMLElement>(selector)?.getAttribute(attribute)
    )
    if (value) return value
  }
  return ""
}

const canonicalVideoUrl = (url: string): string => {
  try {
    const parsed = new URL(url)
    const videoId = parsed.searchParams.get("v")
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : url
  } catch {
    return url
  }
}

const extractYouTubeMetadata = (currentUrl: string, pageTitle: string) => {
  const channel =
    firstText([
      "ytd-video-owner-renderer ytd-channel-name a",
      "#owner ytd-channel-name a",
      "#channel-name a",
      "ytd-watch-metadata ytd-channel-name a"
    ]) || "unknown"

  const likes =
    firstAttribute(
      [
        'segmented-like-dislike-button-view-model button[aria-label*="like" i]',
        '#top-level-buttons-computed button[aria-label*="like" i]',
        'ytd-toggle-button-renderer:first-child button[aria-label*="like" i]'
      ],
      "aria-label"
    ) ||
    firstText([
      "segmented-like-dislike-button-view-model like-button-view-model",
      "#top-level-buttons-computed ytd-toggle-button-renderer:first-child"
    ]) ||
    "unavailable"

  const dislikes =
    firstAttribute(
      [
        'segmented-like-dislike-button-view-model button[aria-label*="dislike" i]',
        '#top-level-buttons-computed button[aria-label*="dislike" i]'
      ],
      "aria-label"
    ) || "unavailable"

  return [
    `Video URL: ${canonicalVideoUrl(currentUrl)}`,
    `Title: ${pageTitle}`,
    `Channel: ${channel}`,
    `Likes: ${likes}`,
    `Dislikes: ${dislikes}`,
    "Transcript:"
  ].join("\n")
}

export const handleGetPageContent = async (
  sendResponse: (response: unknown) => void
): Promise<void> => {
  const storedTabAccess = await plasmoGlobalStorage.get<boolean>(
    STORAGE_KEYS.BROWSER.TABS_ACCESS
  )
  const tabAccessEnabled = storedTabAccess ?? DEFAULT_TABS_ACCESS

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
  const udemyLecturePage = isUdemyLecturePage(currentUrl)

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
    const metadata = extractYouTubeMetadata(currentUrl, pageTitle)

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
      metadata,
      allowMissing: true
    })
    return
  }

  if (udemyLecturePage) {
    logger.info(
      "Udemy lecture page detected; trying transcript before page extraction",
      "ContentScript",
      { url: currentUrl }
    )
    const pageTitle = resolvePageTitle(document, "")
    const transcript = await getTranscript()
    const sent = sendTranscriptOnlyResponse({
      sendResponse,
      currentUrl,
      pageTitle,
      transcript,
      platform: "udemy",
      missingMessage: "No transcript found for this Udemy lecture."
    })

    if (sent) return

    logger.info(
      "Udemy transcript not found; falling back to regular page extraction",
      "ContentScript",
      { url: currentUrl }
    )
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
