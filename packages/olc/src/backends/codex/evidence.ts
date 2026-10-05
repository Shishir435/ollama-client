/**
 * What a Codex turn reports besides its text: token usage, the context window,
 * the pages its native search consulted, and why it failed.
 *
 * Pure readers over App Server notification payloads, kept apart from the turn
 * so each field's reading can be tested against the shape Codex sends.
 */
import { isRecord } from "../../util.js"
import type { TurnError, TurnSource, TurnUsage } from "../types.js"

/** Sources sent per answer at most. A search returns a dozen hits; few matter. */
export const MAX_CODEX_SOURCES = 8

/** Search hits listed when the answer neither cites nor opens a page. */
const UNCITED_SEARCH_SOURCES = 5

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0

/**
 * Codex's `TokenUsageBreakdown` in OpenAI's terms. Codex counts cached input
 * inside `inputTokens` and reasoning inside `outputTokens`, as OpenAI does, so
 * neither is added again.
 */
export const readCodexUsage = (breakdown: unknown): TurnUsage | null => {
  if (!isRecord(breakdown)) return null
  const usage: TurnUsage = {
    promptTokens: count(breakdown.inputTokens),
    completionTokens: count(breakdown.outputTokens)
  }
  const cached = count(breakdown.cachedInputTokens)
  const reasoning = count(breakdown.reasoningOutputTokens)
  if (cached) usage.cachedPromptTokens = cached
  if (reasoning) usage.reasoningTokens = reasoning
  return usage
}

/** The context window `thread/tokenUsage/updated` reports, when it does. */
export const readCodexContextWindow = (tokenUsage: unknown): number | null => {
  if (!isRecord(tokenUsage)) return null
  const value = tokenUsage.modelContextWindow
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null
}

const httpUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null
  } catch {
    return null
  }
}

/** A link in Markdown or bare text; stops where Markdown or prose would. */
const ANSWER_LINK = /https?:\/\/[^\s<>"'`()[\]]+/g

/**
 * The links an answer makes, in order, normalised the way result URLs are so
 * the two compare whole: a site's home page is not "cited" by a deep link
 * that merely starts with it.
 */
const answerLinks = (answer: string): string[] =>
  [...answer.matchAll(ANSWER_LINK)]
    .map((match) => httpUrl(match[0].replace(/[.,;:!?]+$/, "")))
    .filter((url): url is string => url !== null)

const hostOf = (url: string): string => new URL(url).hostname

/** One hit from a `webSearch` item's `results`, which Codex passes through as opaque JSON. */
const readResult = (value: unknown): TurnSource | null => {
  if (!isRecord(value)) return null
  const url = httpUrl(value.url)
  if (!url) return null
  const title = typeof value.title === "string" ? value.title.trim() : ""
  return title ? { url, title } : { url }
}

interface SearchPages {
  titles: Map<string, string>
  opened: string[]
  searched: string[]
}

/** Split the items' pages into opened and merely listed, keeping first titles. */
const gatherSearchPages = (
  webSearchItems: readonly Record<string, unknown>[]
): SearchPages => {
  const pages: SearchPages = { titles: new Map(), opened: [], searched: [] }
  for (const item of webSearchItems) {
    const action = isRecord(item.action) ? item.action : {}
    const isOpen = action.type === "openPage" || action.type === "findInPage"
    const bucket = isOpen ? pages.opened : pages.searched
    const results = Array.isArray(item.results) ? item.results : []
    for (const source of results.map(readResult)) {
      if (!source) continue
      if (source.title && !pages.titles.has(source.url)) {
        pages.titles.set(source.url, source.title)
      }
      bucket.push(source.url)
    }
    const actionUrl = isOpen ? httpUrl(action.url) : null
    if (actionUrl) pages.opened.push(actionUrl)
  }
  return pages
}

/**
 * Sources for one answer, from the turn's completed `webSearch` items.
 *
 * Ranked by how close each page came to the answer: a page the answer links,
 * then a page the model opened, then a search hit.
 *
 * A link counts as cited when it is a page the search saw, or a page on a
 * site the search returned — Codex does not list every page it reached from a
 * result, and the answer links the page it read rather than the hit that led
 * there. A link to a site the turn never touched is the model's own text, not
 * a source, and is left out.
 *
 * A hit the model only saw in a result list is listed only when nothing was
 * cited or opened: a search returns a dozen pages, most of them unread, and
 * listing them all would claim a reading that never happened.
 */
export const collectCodexSources = (
  webSearchItems: readonly Record<string, unknown>[],
  answer: string
): TurnSource[] => {
  const { titles, opened, searched } = gatherSearchPages(webSearchItems)
  const known = new Set([...opened, ...searched])
  const visitedHosts = new Set([...known].map(hostOf))
  const cited = answerLinks(answer).filter(
    (url) => known.has(url) || visitedHosts.has(hostOf(url))
  )
  const ranked =
    cited.length > 0 || opened.length > 0
      ? [...cited, ...opened]
      : searched.slice(0, UNCITED_SEARCH_SOURCES)

  const seen = new Set<string>()
  const sources: TurnSource[] = []
  for (const url of ranked) {
    if (seen.has(url)) continue
    seen.add(url)
    const title = titles.get(url)
    sources.push(title ? { url, title } : { url })
    if (sources.length >= MAX_CODEX_SOURCES) break
  }
  return sources
}

/**
 * The HTTP status a `codexErrorInfo` stands for.
 *
 * Codex forwards the upstream status on its transport variants; the named ones
 * are mapped to the status a client already knows how to act on. Anything
 * unrecognised stays a gateway failure rather than being guessed at.
 */
const statusForErrorInfo = (info: unknown): number | undefined => {
  if (typeof info === "string") {
    switch (info) {
      case "usageLimitExceeded":
      case "rateLimitExceeded":
        return 429
      case "serverOverloaded":
      case "flexUnavailable":
        return 503
      case "unauthorized":
        return 401
      case "contextWindowExceeded":
      case "badRequest":
        return 400
      default:
        return undefined
    }
  }
  if (!isRecord(info)) return undefined
  for (const value of Object.values(info)) {
    if (!isRecord(value)) continue
    const status = value.httpStatusCode
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
    ) {
      return status
    }
  }
  return undefined
}

/**
 * Seconds until the account's exhausted rate-limit window resets, from the
 * latest `account/rateLimits/updated` snapshot. Only a window at 100% counts:
 * the reset of a window with room left says nothing about when to retry.
 */
export const retryAfterFromRateLimits = (
  snapshot: unknown,
  nowMs = Date.now()
): number | undefined => {
  if (!isRecord(snapshot)) return undefined
  const resets = [snapshot.primary, snapshot.secondary]
    .filter(isRecord)
    .filter(
      (window) =>
        typeof window.usedPercent === "number" && window.usedPercent >= 100
    )
    .map((window) => window.resetsAt)
    .filter((value): value is number => typeof value === "number")
  if (resets.length === 0) return undefined
  const seconds = Math.ceil(Math.max(...resets) - nowMs / 1000)
  return seconds > 0 ? seconds : undefined
}

/**
 * A failed turn's error with the status Codex's classification implies.
 * `contextWindowExceeded` keeps OpenAI's code in its type, which is what a
 * client matches to tell an oversized prompt from a broken model.
 */
export const classifyCodexError = ({
  message,
  type,
  errorInfo,
  rateLimits,
  nowMs
}: {
  message: string
  type: string
  errorInfo: unknown
  rateLimits?: unknown
  nowMs?: number
}): TurnError => {
  const status = statusForErrorInfo(errorInfo)
  const retryAfterSeconds =
    status === 429 ? retryAfterFromRateLimits(rateLimits, nowMs) : undefined
  return {
    message,
    type:
      errorInfo === "contextWindowExceeded" ? "context_length_exceeded" : type,
    ...(status !== undefined ? { status } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {})
  }
}
