import { z } from "zod"
import { TAVILY_SEARCH_ENDPOINT } from "../config"
import type { WebSearchBackend } from "../types"
import {
  assertOkResponse,
  clampSearchCount,
  decodeSearchJson,
  normalizeResult,
  requireApiKey
} from "./shared"

const OptionalString = z.string().optional().catch(undefined)
const TavilyResponseSchema = z
  .object({
    results: z.array(
      z
        .object({
          title: OptionalString,
          url: OptionalString,
          content: OptionalString,
          published_date: OptionalString,
          score: z.number().optional().catch(undefined)
        })
        .passthrough()
    )
  })
  .passthrough()

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
    const data = await decodeSearchJson(
      response,
      TavilyResponseSchema,
      "Tavily"
    )
    return (data.results ?? [])
      .slice(0, count)
      .map((item) =>
        normalizeResult({
          title: item.title,
          url: item.url,
          snippet: item.content,
          publishedAt: item.published_date,
          score: item.score
        })
      )
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  }
}
