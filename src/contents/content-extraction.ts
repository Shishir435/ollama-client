import { Readability } from "@mozilla/readability"
import Defuddle from "defuddle"

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
    console.warn("[Content Script] Defuddle failed:", error)
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
    console.error("[Content Script] Readability failed:", error)
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

/**
 * Pick the best available readable-content extractor for the page, honoring
 * the user's `contentScraper` preference. Falls back through the chain:
 *
 *   "auto"          → Defuddle → Readability (if defuddle short) → basic
 *   "defuddle"      → Defuddle only (no fallback)
 *   "readability"   → Readability only
 *
 * Returns a `ReadableContent` with the selected extractor metadata. If
 * everything fails to produce 50+ chars, returns a basic-fallback record
 * which may have empty `readableText` — the caller decides whether that
 * constitutes failure.
 */
export const extractReadableContent = (
  doc: Document,
  scraper: ContentExtractionConfig["contentScraper"]
): ReadableContent => {
  // 1. Defuddle, if requested.
  let current: ReadableContent | null = null
  if (scraper === "auto" || scraper === "defuddle") {
    current = tryDefuddle(doc)
  }

  // 2. Readability if (a) forced, or (b) auto + defuddle returned thin content.
  const defuddleTooShort =
    !current ||
    !current.readableText ||
    current.readableText.trim().length < MIN_DEFUDDLE_FALLBACK_THRESHOLD

  if (scraper === "readability" || (scraper === "auto" && defuddleTooShort)) {
    const readability = tryReadability(doc, scraper === "readability")
    if (readability) {
      const useReadability =
        scraper === "readability" ||
        !current ||
        readability.readableText.length > current.readableText.length ||
        current.readableText.trim().length < MIN_READABILITY_FALLBACK_THRESHOLD
      if (useReadability) {
        // Preserve any title we already had from Defuddle if Readability
        // returned an empty one.
        if (!readability.pageTitle && current?.pageTitle) {
          readability.pageTitle = current.pageTitle
        }
        current = readability
      } else if (current && !current.pageTitle && readability.pageTitle) {
        current.pageTitle = readability.pageTitle
      }
    }
  }

  // 3. Basic body fallback when we still have nothing useful.
  const stillTooShort =
    !current ||
    !current.readableText ||
    current.readableText.trim().length < MIN_READABILITY_FALLBACK_THRESHOLD
  if (stillTooShort) {
    const basic = tryBasic(doc)
    if (basic) {
      // Carry forward any title we found earlier.
      if (current?.pageTitle) basic.pageTitle = current.pageTitle
      current = basic
    }
  }

  return (
    current ?? {
      readableText: "",
      pageTitle: "",
      selectedExtractor: "basic",
      selectedReason: "fallback-basic"
    }
  )
}

/**
 * Resolve the best title for a page from extractor output + meta tags +
 * document.title. Cleans common " - SiteName" suffixes. Returns "Untitled"
 * as a final fallback.
 */
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
