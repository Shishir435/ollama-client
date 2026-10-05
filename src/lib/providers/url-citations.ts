/**
 * OpenAI `url_citation` annotations, as sources for an answer.
 *
 * OpenAI's search models, OpenRouter's web plugin and the olc proxy all report
 * the pages a provider-side search consulted this way. Annotations are
 * provider-written data: each one is validated to an http(s) URL before it can
 * become a link, and anything else in the array is ignored rather than
 * guessed at. Deduplication and the per-message cap belong to the stream
 * reducer, which merges every chunk's citations for the turn.
 */
import {
  type WebCitation,
  WebCitationSchema
} from "@ollama-client/contracts/chat"

/** The citations in one `annotations` array, in order, invalid ones dropped. */
export const readUrlCitations = (annotations: unknown): WebCitation[] => {
  if (!Array.isArray(annotations)) return []
  const citations: WebCitation[] = []
  for (const annotation of annotations as Array<{
    type?: unknown
    url_citation?: { url?: unknown; title?: unknown } | null
  } | null>) {
    const citation = annotation?.url_citation
    if (annotation?.type !== "url_citation" || !citation) continue
    const title =
      typeof citation.title === "string" ? citation.title.trim() : ""
    const parsed = WebCitationSchema.safeParse({
      url: typeof citation.url === "string" ? citation.url.trim() : undefined,
      ...(title ? { title: title.slice(0, 512) } : {})
    })
    if (parsed.success) citations.push(parsed.data)
  }
  return citations
}
