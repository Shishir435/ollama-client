import type { z } from "zod"
import { webSearchHttpError } from "../failure"
import {
  WebSearchError,
  type WebSearchConfigValidation,
  WebSearchProviderConfig,
  WebSearchResult,
  WebSearchTimeRange
} from "../types"

export const DEFAULT_SEARCH_COUNT = 5
export const MAX_SEARCH_COUNT = 10
export const DEFAULT_SEARXNG_PAGES = 1
export const MAX_SEARXNG_PAGES = 3

export const WEB_SEARCH_TIME_RANGES: readonly WebSearchTimeRange[] = [
  "day",
  "week",
  "month",
  "year"
]

/** Returns the value only if it is a valid time range, else undefined. */
export const parseTimeRange = (
  value: unknown
): WebSearchTimeRange | undefined =>
  typeof value === "string" &&
  (WEB_SEARCH_TIME_RANGES as readonly string[]).includes(value)
    ? (value as WebSearchTimeRange)
    : undefined

export const clampSearchCount = (count?: number): number => {
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return DEFAULT_SEARCH_COUNT
  }
  return Math.min(Math.max(Math.floor(count), 1), MAX_SEARCH_COUNT)
}

export const clampSearchPages = (pages?: number): number => {
  if (typeof pages !== "number" || !Number.isFinite(pages)) {
    return DEFAULT_SEARXNG_PAGES
  }
  return Math.min(Math.max(Math.floor(pages), 1), MAX_SEARXNG_PAGES)
}

export const requireApiKey = (
  config: WebSearchProviderConfig,
  errorKey: string
): WebSearchConfigValidation =>
  config.apiKey?.trim() ? { ok: true } : { ok: false, errorKey }

export const requireEndpoint = (
  config: WebSearchProviderConfig,
  errorKey: string
): WebSearchConfigValidation => {
  const endpoint = config.endpoint?.trim()
  if (!endpoint) return { ok: false, errorKey }
  try {
    const url = new URL(endpoint)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, errorKey }
    }
    return { ok: true }
  } catch {
    return { ok: false, errorKey }
  }
}

export const getHostLabel = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return undefined
  }
}

export const stripHtml = (value: unknown): string => {
  if (typeof value !== "string") return ""
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export const normalizeResult = (
  result: Partial<WebSearchResult>
): WebSearchResult | null => {
  const title = stripHtml(result.title)
  const url = typeof result.url === "string" ? result.url.trim() : ""
  const snippet = stripHtml(result.snippet)
  if (!title || !url) return null
  return {
    title,
    url,
    snippet,
    publishedAt: result.publishedAt,
    source: result.source ?? getHostLabel(url),
    score: typeof result.score === "number" ? result.score : undefined,
    category: result.category
  }
}

export const assertOkResponse = async (
  response: Response,
  provider: string
): Promise<void> => {
  if (response.ok) return
  throw webSearchHttpError(provider, response.status)
}

/**
 * What an unreadable body means per backend. SearXNG's is a setting: it serves
 * only the formats listed under `search.formats`, and the stock list is `html`.
 */
const NOT_JSON_KEY: Record<string, string> = {
  SearXNG: "settings.web_search.errors.searxng_json_disabled"
}

/** Decode a search backend response at the network boundary. */
export const decodeSearchJson = async <T>(
  response: Response,
  schema: z.ZodType<T>,
  provider: string
): Promise<T> => {
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    /**
     * Only a parse failure means the body was not JSON. An abort or a dropped
     * connection while reading it keeps its own cause.
     */
    if (!(error instanceof SyntaxError)) throw error
    throw new WebSearchError(
      `${provider} search returned invalid JSON`,
      NOT_JSON_KEY[provider] ?? "settings.web_search.failures.not_json"
    )
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new Error(`${provider} search returned an invalid response`)
  }
  return parsed.data
}
