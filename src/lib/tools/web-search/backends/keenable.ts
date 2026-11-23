import { z } from "zod"
import { KEENABLE_SEARCH_ENDPOINT } from "../config"
import type { WebSearchBackend } from "../types"
import {
  assertOkResponse,
  clampSearchCount,
  decodeSearchJson,
  getHostLabel,
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
          snippet: OptionalString,
          published_at: OptionalString
        })
        .passthrough()
    )
  })
  .passthrough()

/** Keenable accepts relative deltas for `published_after`. */
const publishedAfter = { day: "1d", week: "7d", month: "30d", year: "365d" }

/** Snippets otherwise run to thousands of characters, which the tool would cut anyway. */
const SNIPPET_MAX_LENGTH = 500

/**
 * Keenable-written summaries whose links expire after a day. `disable_cards`
 * would drop them, but the API rejects it alongside safe search.
 */
const CARD_HOST = "cards.keenable.ai"

export const keenableBackend: WebSearchBackend = {
  id: "keenable",
  labelKey: "settings.web_search.providers.keenable",
  fields: ["apiKey"],
  baseUrl: KEENABLE_SEARCH_ENDPOINT,
  supports: { safeSearch: true, timeRange: true },
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
      // The API rejects unknown fields, so send only documented ones.
      body: JSON.stringify({
        query: q.query,
        max_results: count,
        snippet_max_length: SNIPPET_MAX_LENGTH,
        ...(safeSearch ? { safety_mode: safeSearch } : {}),
        ...(q.timeRange ? { published_after: publishedAfter[q.timeRange] } : {})
      })
    })
    await assertOkResponse(response, "Keenable")
    const data = await decodeSearchJson(
      response,
      KeenableResponseSchema,
      "Keenable"
    )
    return data.results
      .filter((item) => !item.url || getHostLabel(item.url) !== CARD_HOST)
      .slice(0, count)
      .map((item) =>
        normalizeResult({
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          publishedAt: item.published_at
        })
      )
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  }
}
