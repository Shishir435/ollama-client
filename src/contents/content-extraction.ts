import { Readability } from "@mozilla/readability"
import Defuddle from "defuddle"

import { logger } from "@/lib/logger"
import { normalizeWhitespaceForLLM } from "@/lib/text-utils"
import type { ContentExtractionConfig } from "@/types"

import { stripHtmlIfNeeded } from "./extraction-helpers"

export type SelectedExtractor = "defuddle" | "readability" | "basic"

export interface ReadableContent {
  readableText: string
  pageTitle: string
  selectedExtractor: SelectedExtractor
  selectedReason: string
}

const MIN_DEFUDDLE_FALLBACK_THRESHOLD = 100
const MIN_READABILITY_FALLBACK_THRESHOLD = 50
const MIN_BASIC_FALLBACK_THRESHOLD = 200

const tryDefuddle = (doc: Document): ReadableContent | null => {
  try {
    const defuddle = new Defuddle(doc, {
      markdown: true,
      separateMarkdown: false,
      removeExactSelectors: true
    })
    const result = defuddle.parse()
    const raw = result?.contentMarkdown || result?.content || ""
    if (!raw) return null

    const readableText = stripHtmlIfNeeded(normalizeWhitespaceForLLM(raw))
    return {
      readableText,
      pageTitle: result?.title || "",
      selectedExtractor: "defuddle",
      selectedReason: result?.contentMarkdown
        ? "defuddle-markdown"
        : "defuddle-html"
    }
  } catch (error) {
    logger.warn("Defuddle failed", "ContentExtraction", { error })
    return null
  }
}

const tryReadability = (
  doc: Document,
  forced: boolean
): ReadableContent | null => {
  try {
    const article = new Readability(doc.cloneNode(true) as Document).parse()
    const text = article?.textContent || ""
    const normalized = normalizeWhitespaceForLLM(text)
    if (!normalized) return null

    return {
      readableText: stripHtmlIfNeeded(normalized),
      pageTitle: article?.title || "",
      selectedExtractor: "readability",
      selectedReason: forced ? "forced-readability" : "auto-readability-better"
    }
  } catch (error) {
    logger.error("Readability failed", "ContentExtraction", { error })
    return null
  }
}

const tryBasic = (doc: Document): ReadableContent | null => {
  const bodyText = doc.body?.textContent || ""
  const normalized = normalizeWhitespaceForLLM(bodyText)
  if (normalized.length <= MIN_BASIC_FALLBACK_THRESHOLD) return null
  return {
    readableText: stripHtmlIfNeeded(normalized),
    pageTitle: "",
    selectedExtractor: "basic",
    selectedReason: "basic-body-fallback"
  }
}

const shouldTryReadability = (
  scraper: ContentExtractionConfig["contentScraper"],
  current: ReadableContent | null
): boolean => {
  if (scraper === "readability") return true
  if (scraper !== "auto") return false
  const readableText = current?.readableText.trim()
  return !readableText || readableText.length < MIN_DEFUDDLE_FALLBACK_THRESHOLD
}

const mergeReadability = (
  current: ReadableContent | null,
  readability: ReadableContent,
  forced: boolean
): ReadableContent => {
  const useReadability =
    forced ||
    !current ||
    readability.readableText.length > current.readableText.length ||
    current.readableText.trim().length < MIN_READABILITY_FALLBACK_THRESHOLD

  if (useReadability) {
    if (!readability.pageTitle && current?.pageTitle) {
      readability.pageTitle = current.pageTitle
    }
    return readability
  }
  if (!current.pageTitle && readability.pageTitle) {
    current.pageTitle = readability.pageTitle
  }
  return current
}

const applyBasicFallback = (
  doc: Document,
  current: ReadableContent | null
): ReadableContent | null => {
  const hasUsefulContent =
    current?.readableText &&
    current.readableText.trim().length >= MIN_READABILITY_FALLBACK_THRESHOLD
  if (hasUsefulContent) return current

  const basic = tryBasic(doc)
  if (!basic) return current
  if (current?.pageTitle) basic.pageTitle = current.pageTitle
  return basic
}

export const extractReadableContent = (
  doc: Document,
  scraper: ContentExtractionConfig["contentScraper"]
): ReadableContent => {
  let current =
    scraper === "auto" || scraper === "defuddle" ? tryDefuddle(doc) : null

  if (shouldTryReadability(scraper, current)) {
    const readability = tryReadability(doc, scraper === "readability")
    if (readability) {
      current = mergeReadability(current, readability, scraper === "readability")
    }
  }

  current = applyBasicFallback(doc, current)
  return (
    current ?? {
      readableText: "",
      pageTitle: "",
      selectedExtractor: "basic",
      selectedReason: "fallback-basic"
    }
  )
}

export const resolvePageTitle = (
  doc: Document,
  extractorTitle: string
): string => {
  let title = extractorTitle

  if (!title) {
    const ogTitle = doc
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content")
    const twitterTitle = doc
      .querySelector('meta[name="twitter:title"]')
      ?.getAttribute("content")
    const metaTitle = doc
      .querySelector('meta[name="title"]')
      ?.getAttribute("content")

    title = ogTitle || twitterTitle || metaTitle || doc.title || ""
  }

  if (
    title &&
    !title.toLowerCase().includes("untitled") &&
    title.trim().length > 0
  ) {
    return title
      .replace(/\s*[-|]\s*.*$/, "")
      .replace(/\s*:\s*.*$/, "")
      .trim()
  }

  return doc.title || "Untitled"
}
