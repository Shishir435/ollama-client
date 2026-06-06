import type { extractContentWithLoading } from "@/lib/content-extractor"

import {
  detectSiteProfile,
  measureReliability,
  quickHash
} from "./extraction-helpers"
import { safeSendResponse } from "./message-response"

export const buildExtractionDebug = ({
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

export const sendTranscriptOnlyResponse = ({
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
  platform: "youtube" | "udemy"
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
