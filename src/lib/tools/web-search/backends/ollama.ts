import { z } from "zod"
import { OLLAMA_SEARCH_ENDPOINT } from "../config"
import { WebSearchError, type WebSearchBackend } from "../types"
import {
  assertOkResponse,
  clampSearchCount,
  decodeSearchJson,
  normalizeResult,
  requireApiKey
} from "./shared"

const OllamaSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string()
    })
  )
})

/** Ollama's hosted search works independently of the model's inference host. */
export const ollamaBackend: WebSearchBackend = {
  id: "ollama",
  labelKey: "settings.web_search.providers.ollama",
  validateConfig: (config) =>
    requireApiKey(config, "settings.web_search.errors.api_key_required"),
  search: async (q, config, signal) => {
    signal?.throwIfAborted()
    if (!config.apiKey?.trim()) {
      throw new WebSearchError(
        "Ollama search requires an API key from your Ollama account.",
        "settings.web_search.errors.api_key_required"
      )
    }
    const count = clampSearchCount(q.count ?? config.count)
    const response = await fetch(OLLAMA_SEARCH_ENDPOINT, {
      method: "POST",
      signal,
      credentials: "omit",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify({ query: q.query, max_results: count })
    })
    await assertOkResponse(response, "Ollama")
    const data = await decodeSearchJson(
      response,
      OllamaSearchResponseSchema,
      "Ollama"
    )
    signal?.throwIfAborted()
    return data.results
      .slice(0, count)
      .map((item) =>
        normalizeResult({
          title: item.title,
          url: item.url,
          snippet: item.content
        })
      )
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  }
}
