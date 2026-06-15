import type {
  WebSearchBackend,
  WebSearchProviderConfig,
  WebSearchTimeRange
} from "../types"
import {
  assertOkResponse,
  clampSearchCount,
  clampSearchPages,
  normalizeResult,
  requireEndpoint
} from "./shared"

interface SearxngResult {
  title?: string
  url?: string
  content?: string
  publishedDate?: string
  engine?: string
}

interface SearxngResponse {
  results?: SearxngResult[]
}

const safeSearchMap = {
  off: "0",
  moderate: "1",
  strict: "2"
} as const

const buildSearchUrl = (
  config: WebSearchProviderConfig,
  query: string,
  page: number,
  safeSearch?: keyof typeof safeSearchMap,
  timeRange?: WebSearchTimeRange
) => {
  const base = new URL(config.endpoint?.trim() ?? "")
  const path = base.pathname.endsWith("/search")
    ? base.pathname
    : `${base.pathname.replace(/\/$/, "")}/search`
  base.pathname = path
  base.searchParams.set("q", query)
  base.searchParams.set("format", "json")
  base.searchParams.set("pageno", String(page))
  base.searchParams.set("safesearch", safeSearchMap[safeSearch ?? "moderate"])
  // SearXNG accepts day/week/month/year directly.
  if (timeRange) base.searchParams.set("time_range", timeRange)
  return base
}

const dedupeResults = (results: SearxngResult[]) => {
  const seen = new Set<string>()
  return results.filter((result) => {
    const key = result.url?.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const searxngBackend: WebSearchBackend = {
  id: "searxng",
  labelKey: "settings.web_search.providers.searxng",
  validateConfig: (config) =>
    requireEndpoint(config, "settings.web_search.errors.endpoint_required"),
  search: async (q, config, signal) => {
    const count = clampSearchCount(q.count ?? config.count)
    const pages = clampSearchPages(config.searxngPages)
    const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1)

    const pageResults = await Promise.all(
      pageNumbers.map(async (page) => {
        const url = buildSearchUrl(
          config,
          q.query,
          page,
          q.safeSearch ?? config.safeSearch,
          q.timeRange
        )
        const response = await fetch(url, {
          signal,
          headers: { Accept: "application/json" }
        })
        await assertOkResponse(response, "SearXNG")
        const data = (await response.json()) as SearxngResponse
        return data.results ?? []
      })
    )
    const results: SearxngResult[] = pageResults.flat()

    return dedupeResults(results)
      .slice(0, count)
      .map((item) =>
        normalizeResult({
          title: item.title,
          url: item.url,
          snippet: item.content,
          publishedAt: item.publishedDate,
          source: item.engine
        })
      )
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  }
}
