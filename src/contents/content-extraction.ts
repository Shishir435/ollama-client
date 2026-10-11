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

/**
 * Elements the page has not rendered: a closed `<dialog>` and anything under
 * `hidden`, `until-found` included — the browser removes the attribute when
 * it reveals the section, so while it is present the text is not on screen.
 */
const UNRENDERED_SELECTOR = "dialog:not([open]), [hidden]"

/**
 * A copy of the page without what it is not displaying. Readability and the
 * body-text fallback read a copy with no styles, so a closed dialog's text
 * came through as though it were on screen, and the chat model reported a
 * status it had never opened. Defuddle reads computed styles off the live
 * document and is not given this copy.
 */
const renderedCopy = (doc: Document): Document => {
  const copy = doc.cloneNode(true) as Document
  for (const element of copy.querySelectorAll(UNRENDERED_SELECTOR)) {
    element.remove()
  }
  return copy
}

/**
 * Words only, lowercased: Defuddle writes Markdown, so `**Status:** Active`
 * has to compare equal to the "Status: Active" the page held.
 */
const comparableText = (text: string | null | undefined): string =>
  ` ${(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `

/**
 * Every run of `HIDDEN_RUN_WORDS` consecutive words in a hidden piece, or the
 * whole piece when it is shorter. Defuddle may keep part of a hidden
 * sentence — "Account status: Active" of "Account status: Active since
 * March" — so the whole piece need not appear for its text to have leaked.
 */
const HIDDEN_RUN_WORDS = 3
const wordRuns = (piece: string): string[] => {
  const words = comparableText(piece).trim().split(" ").filter(Boolean)
  if (words.length === 0) return []
  if (words.length <= HIDDEN_RUN_WORDS) return [` ${words.join(" ")} `]
  return words
    .slice(0, words.length - HIDDEN_RUN_WORDS + 1)
    .map(
      (_, start) =>
        ` ${words.slice(start, start + HIDDEN_RUN_WORDS).join(" ")} `
    )
}

/** Each run of text an element holds, so formatting between them cannot hide one. */
const textPieces = (node: Node): string[] =>
  node.nodeType === 3
    ? [node.textContent ?? ""]
    : [...node.childNodes].flatMap(textPieces)

/**
 * Whether Defuddle's result carries text only an unrendered element holds.
 *
 * Defuddle has to read the live document for its computed styles, so it
 * cannot be handed the rendered copy — and when a page yields under fifty
 * words it parses again with hidden-element removal off, which brings a
 * closed dialog's or a `hidden` section's text straight back. Text that the
 * rendered copy also shows is not a leak; text only a hidden element holds
 * is, and the result is dropped for the fallbacks, which read the copy.
 */
const showsUnrenderedText = (
  doc: Document,
  rendered: Document,
  extracted: string
): boolean => {
  const haystack = comparableText(extracted)
  const shown = comparableText(rendered.body?.textContent)
  for (const element of doc.querySelectorAll(UNRENDERED_SELECTOR)) {
    for (const piece of textPieces(element)) {
      for (const run of wordRuns(piece)) {
        if (haystack.includes(run) && !shown.includes(run)) return true
      }
    }
  }
  return false
}

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
  rendered: Document,
  forced: boolean
): ReadableContent | null => {
  try {
    const article = new Readability(
      rendered.cloneNode(true) as Document
    ).parse()
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

const tryBasic = (rendered: Document): ReadableContent | null => {
  const bodyText = rendered.body?.textContent || ""
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
  rendered: Document,
  current: ReadableContent | null
): ReadableContent | null => {
  const hasUsefulContent =
    current?.readableText &&
    current.readableText.trim().length >= MIN_READABILITY_FALLBACK_THRESHOLD
  if (hasUsefulContent) return current

  const basic = tryBasic(rendered)
  if (!basic) return current
  if (current?.pageTitle) basic.pageTitle = current.pageTitle
  return basic
}

export const extractReadableContent = (
  doc: Document,
  scraper: ContentExtractionConfig["contentScraper"]
): ReadableContent => {
  const rendered = renderedCopy(doc)
  let current =
    scraper === "auto" || scraper === "defuddle" ? tryDefuddle(doc) : null
  if (current && showsUnrenderedText(doc, rendered, current.readableText))
    current = null

  if (shouldTryReadability(scraper, current)) {
    const readability = tryReadability(rendered, scraper === "readability")
    if (readability) {
      current = mergeReadability(
        current,
        readability,
        scraper === "readability"
      )
    }
  }

  current = applyBasicFallback(rendered, current)
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
