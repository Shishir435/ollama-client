import { z } from "zod"
import { BRAVE_SEARCH_ENDPOINT } from "../config"
import type { WebSearchBackend } from "../types"
import {
  assertOkResponse,
  clampSearchCount,
  decodeSearchJson,
  normalizeResult,
  requireApiKey
} from "./shared"

const OptionalString = z.string().optional().catch(undefined)
const BraveResponseSchema = z
  .object({
    web: z
      .object({
        results: z.array(
          z
            .object({
              title: OptionalString,
              url: OptionalString,
              description: OptionalString,
              extra_snippets: z.array(z.string()).optional().catch(undefined),
              meta_url: z
                .object({ hostname: OptionalString })
                .passthrough()
                .optional()
                .catch(undefined),
              profile: z
                .object({ name: OptionalString })
                .passthrough()
                .optional()
                .catch(undefined),
              age: OptionalString
            })
            .passthrough()
        )
      })
      .passthrough()
      .nullable()
      .optional()
  })
  .passthrough()

const safeSearchMap = {
  off: "off",
  moderate: "moderate",
  strict: "strict"
} as const

/** Brave expresses recency via `freshness`: pd/pw/pm/py = past day/week/month/year. */
const freshnessMap = {
  day: "pd",
  week: "pw",
  month: "pm",
  year: "py"
} as const

export const braveBackend: WebSearchBackend = {
  id: "brave",
  labelKey: "settings.web_search.providers.brave",
  validateConfig: (config) =>
    requireApiKey(config, "settings.web_search.errors.api_key_required"),
  search: async (q, config, signal) => {
    const count = clampSearchCount(q.count ?? config.count)
    const url = new URL(BRAVE_SEARCH_ENDPOINT)
    url.searchParams.set("q", q.query)
    url.searchParams.set("count", String(count))
    url.searchParams.set(
      "safesearch",
      safeSearchMap[q.safeSearch ?? config.safeSearch ?? "moderate"]
    )
    if (q.lang) url.searchParams.set("search_lang", q.lang)
    if (q.timeRange)
      url.searchParams.set("freshness", freshnessMap[q.timeRange])

    const response = await fetch(url, {
      signal,
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": config.apiKey?.trim() ?? ""
      }
    })
    await assertOkResponse(response, "Brave")
    const data = await decodeSearchJson(response, BraveResponseSchema, "Brave")
    return (data.web?.results ?? [])
      .slice(0, count)
      .map((item) =>
        normalizeResult({
          title: item.title,
          url: item.url,
          snippet: [item.description, ...(item.extra_snippets ?? [])]
            .filter(Boolean)
            .join(" "),
          publishedAt: item.age,
          source: item.profile?.name ?? item.meta_url?.hostname
        })
      )
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  }
}
