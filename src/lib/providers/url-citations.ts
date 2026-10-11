/**
 * OpenAI `url_citation` annotations, as sources for an answer.
 *
 * OpenAI's search models, OpenRouter's web plugin and the olc proxy all report
 * the pages a provider-side search consulted this way. Annotations are
 * provider-written data: each one is validated to an http(s) URL before it can
 * become a link, and anything else in the array is ignored rather than
 * guessed at. One array is also capped, because the stream schema rejects a
 * chunk carrying more than the per-message cap and would take every citation
 * in it down with the excess; merging chunks is the stream reducer's job.
 */
import {
  MAX_WEB_CITATIONS,
  type WebCitation,
  WebCitationSchema
} from "@ollama-client/contracts/chat"

/**
 * The citations in one `annotations` array, in order, invalid and repeated
 * ones dropped, at most `MAX_WEB_CITATIONS`.
 */
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
    if (!parsed.success) continue
    if (citations.some(({ url }) => url === parsed.data.url)) continue
    citations.push(parsed.data)
    if (citations.length === MAX_WEB_CITATIONS) break
  }
  return citations
}
