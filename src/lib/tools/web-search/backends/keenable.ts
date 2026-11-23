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

export const keenableBackend: WebSearchBackend = {
  id: "keenable",
  labelKey: "settings.web_search.providers.keenable",
  validateConfig: (config) =>
    requireApiKey(config, "settings.web_search.errors.api_key_required"),
  search: async (q, config, signal) => {
    const count = clampSearchCount(q.count ?? config.count)
    const response = await fetch(KEENABLE_SEARCH_ENDPOINT, {
      method: "POST",
      signal,
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey?.trim() ?? ""
      },
      body: JSON.stringify({ query: q.query, max_results: count })
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
