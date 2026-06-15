import { TAVILY_SEARCH_ENDPOINT } from "../config"
import type { WebSearchBackend } from "../types"
import {
  assertOkResponse,
  clampSearchCount,
  normalizeResult,
  requireApiKey
} from "./shared"

interface TavilyResult {
  title?: string
  url?: string
  content?: string
  raw_content?: string | null
  published_date?: string
  score?: number
}

interface TavilyResponse {
  query?: string
  answer?: string
  images?: unknown[]
  results?: TavilyResult[]
  response_time?: number
  request_id?: string
}

export const tavilyBackend: WebSearchBackend = {
  id: "tavily",
  labelKey: "settings.web_search.providers.tavily",
  validateConfig: (config) =>
    requireApiKey(config, "settings.web_search.errors.api_key_required"),
  search: async (q, config, signal) => {
    const count = clampSearchCount(q.count ?? config.count)
    const response = await fetch(TAVILY_SEARCH_ENDPOINT, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey?.trim() ?? ""}`
      },
      body: JSON.stringify({
        query: q.query,
        max_results: count,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        // Tavily accepts day/week/month/year; omit when not set.
        ...(q.timeRange ? { time_range: q.timeRange } : {})
      })
    })
    await assertOkResponse(response, "Tavily")
    const data = (await response.json()) as TavilyResponse
    return (data.results ?? [])
      .slice(0, count)
      .map((item) =>
        normalizeResult({
          title: item.title,
          url: item.url,
          snippet: item.content,
          publishedAt: item.published_date
        })
      )
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  }
}
