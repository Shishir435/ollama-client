export type WebSearchProviderId = "searxng" | "brave" | "tavily"

export type WebSearchSafeSearch = "off" | "moderate" | "strict"

/** Recency window for time-sensitive queries. Supported by all backends. */
export type WebSearchTimeRange = "day" | "week" | "month" | "year"

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  publishedAt?: string
  /** Search engine / site label the backend reports. */
  source?: string
  /** Relevance score from the backend, when provided. */
  score?: number
  /** Result category (e.g. "general", "news"), when provided. */
  category?: string
}

export interface WebSearchQuery {
  query: string
  count?: number
  safeSearch?: WebSearchSafeSearch
  lang?: string
  /** Restrict to results from the last day/week/month/year. */
  timeRange?: WebSearchTimeRange
}

export interface WebSearchProviderConfig {
  provider: WebSearchProviderId
  endpoint?: string
  apiKey?: string
  count?: number
  searxngPages?: number
  safeSearch?: WebSearchSafeSearch
  enabled?: boolean
}

export interface WebSearchConfigValidation {
  ok: boolean
  errorKey?: string
}

export interface WebSearchBackend {
  id: WebSearchProviderId
  labelKey: string
  search(
    q: WebSearchQuery,
    config: WebSearchProviderConfig,
    signal?: AbortSignal
  ): Promise<WebSearchResult[]>
  validateConfig(config: WebSearchProviderConfig): WebSearchConfigValidation
}
