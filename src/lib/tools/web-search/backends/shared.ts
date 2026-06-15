import type {
  WebSearchConfigValidation,
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
  const message = `${provider} search failed with HTTP ${response.status}`
  throw new Error(message)
}
