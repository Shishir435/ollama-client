import { z } from "zod"
import { KEENABLE_SEARCH_ENDPOINT } from "../config"
import type { WebSearchBackend } from "../types"
import {
  assertOkResponse,
  clampSearchCount,
  decodeSearchJson,
  normalizeResult,
  requireApiKey
} from "./shared"

const OptionalString = z.string().optional().catch(undefined)
const KeenableResponseSchema = z
  .object({
    results: z.array(
      z
        .object({
          title: OptionalString,
          url: OptionalString,
          description: OptionalString,
          snippet: OptionalString
        })
        .passthrough()
    )
  })
  .passthrough()

/** Keenable filters recency with `published_after` (ISO 8601); map the tool's time_range onto it. */
const timeRangeDays = { day: 1, week: 7, month: 30, year: 365 } as const

const publishedAfter = (
  timeRange: keyof typeof timeRangeDays,
  now: number = Date.now()
): string =>
  new Date(now - timeRangeDays[timeRange] * 24 * 60 * 60 * 1000).toISOString()

export const keenableBackend: WebSearchBackend = {
  id: "keenable",
  labelKey: "settings.web_search.providers.keenable",
  validateConfig: (config) =>
    requireApiKey(config, "settings.web_search.errors.api_key_required"),
  search: async (q, config, signal) => {
    const count = clampSearchCount(q.count ?? config.count)
    const safeSearch = q.safeSearch ?? config.safeSearch
    const response = await fetch(KEENABLE_SEARCH_ENDPOINT, {
      method: "POST",
      signal,
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey?.trim() ?? ""
      },
      body: JSON.stringify({
        query: q.query,
        max_results: count,
        // Keenable accepts "off" | "moderate" | "strict", the same values as the settings control
        ...(safeSearch ? { safety_mode: safeSearch } : {}),
        ...(q.timeRange ? { published_after: publishedAfter(q.timeRange) } : {})
      })
    })
    await assertOkResponse(response, "Keenable")
    const data = await decodeSearchJson(
      response,
      KeenableResponseSchema,
      "Keenable"
    )
    return data.results
      .slice(0, count)
      .map((item) =>
        normalizeResult({
          title: item.title,
          url: item.url,
          snippet: item.description || item.snippet
        })
      )
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  }
}
