export type WebSearchProviderId = "searxng" | "brave" | "tavily" | "ollama"

export type WebSearchSafeSearch = "off" | "moderate" | "strict"

export type WebSearchExecutionSource = "auto" | "client" | "native"

export type NativeWebSearchMode = "cached" | "indexed" | "live"

/** Recency window for time-sensitive queries, where the backend supports it. */
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
  /** Where the public `web_search` intent should execute. */
  executionSource?: WebSearchExecutionSource
  /** Requested provider-native search freshness; the runtime may cap it. */
  nativeMode?: NativeWebSearchMode
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

/**
 * A search failure the settings test can explain. `message` is English for the
 * model and the logs; `messageKey` is the i18n key the UI shows instead of the
 * generic "test failed" copy.
 */
export class WebSearchError extends Error {
  readonly messageKey: string

  constructor(message: string, messageKey: string) {
    super(message)
    this.name = "WebSearchError"
    this.messageKey = messageKey
  }
}
