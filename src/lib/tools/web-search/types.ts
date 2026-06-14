export type WebSearchProviderId = "searxng" | "brave" | "tavily"

export type WebSearchSafeSearch = "off" | "moderate" | "strict"

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  publishedAt?: string
  source?: string
}

export interface WebSearchQuery {
  query: string
  count?: number
  safeSearch?: WebSearchSafeSearch
  lang?: string
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
