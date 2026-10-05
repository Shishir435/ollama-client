/**
 * OpenAI `url_citation` annotations, as sources for an answer.
 *
 * OpenAI's search models, OpenRouter's web plugin and the olc proxy all report
 * the pages a provider-side search consulted this way. Annotations are
 * provider-written data: each one is validated to an http(s) URL before it can
 * become a link, and anything else in the array is ignored rather than
 * guessed at.
 */
import {
  MAX_WEB_CITATIONS,
  type WebCitation,
  WebCitationSchema
} from "@ollama-client/contracts/chat"

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

/** The citations in one `annotations` array, in order, invalid ones dropped. */
export const readUrlCitations = (annotations: unknown): WebCitation[] => {
  if (!Array.isArray(annotations)) return []
  const citations: WebCitation[] = []
  for (const annotation of annotations) {
    const record = asRecord(annotation)
    if (record?.type !== "url_citation") continue
    const citation = asRecord(record.url_citation)
    const title =
      typeof citation?.title === "string" ? citation.title.trim() : ""
    const parsed = WebCitationSchema.safeParse({
      url: typeof citation?.url === "string" ? citation.url.trim() : undefined,
      ...(title ? { title: title.slice(0, 512) } : {})
    })
    if (parsed.success) citations.push(parsed.data)
  }
  return citations
}

/**
 * Collects a turn's citations across chunks.
 *
 * Providers send annotations in more than one chunk, and OpenRouter repeats a
 * citation once per span it supports, so the list is deduplicated by URL and
 * capped to what a message persists. `add` answers whether the list changed,
 * so the caller emits only when there is something new to show.
 */
export const createUrlCitationCollector = () => {
  const byUrl = new Map<string, WebCitation>()
  return {
    add(annotations: unknown): boolean {
      let changed = false
      for (const citation of readUrlCitations(annotations)) {
        const known = byUrl.get(citation.url)
        if (known) {
          if (!known.title && citation.title) {
            known.title = citation.title
            changed = true
          }
          continue
        }
        if (byUrl.size >= MAX_WEB_CITATIONS) break
        byUrl.set(citation.url, { ...citation })
        changed = true
      }
      return changed
    },
    list: (): WebCitation[] =>
      [...byUrl.values()].map((citation) => ({ ...citation }))
  }
}
