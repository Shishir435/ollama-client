/**
 * OpenAI `url_citation` annotations, as sources for an answer.
 *
 * OpenAI's search models, OpenRouter's web plugin and the olc proxy all report
 * the pages a provider-side search consulted this way. Annotations are
 * provider-written data: each one is validated to an http(s) URL before it can
 * become a link, and anything else in the array is ignored rather than
 * guessed at. Everything one chunk carries is capped together, because the
 * stream schema rejects a chunk holding more than the per-message cap and
 * would take every citation in it down with the excess — a chunk can report
 * the same sources in both `delta` and `message`, and capping each array
 * alone let the two add up past it. Merging chunks is the stream reducer's
 * job.
 */
import {
  MAX_WEB_CITATIONS,
  type WebCitation,
  WebCitationSchema
} from "@ollama-client/contracts/chat"

/** One annotation as a citation, or nothing if it is not a usable link. */
const readUrlCitation = (annotation: unknown): WebCitation | undefined => {
  const entry = annotation as {
    type?: unknown
    url_citation?: { url?: unknown; title?: unknown } | null
  } | null
  const citation = entry?.url_citation
  if (entry?.type !== "url_citation" || !citation) return undefined
  const title = typeof citation.title === "string" ? citation.title.trim() : ""
  const parsed = WebCitationSchema.safeParse({
    url: typeof citation.url === "string" ? citation.url.trim() : undefined,
    ...(title ? { title: title.slice(0, 512) } : {})
  })
  return parsed.success ? parsed.data : undefined
}

/**
 * The citations in one chunk's `annotations` arrays, in order, invalid ones
 * dropped and repeats merged by URL across every array — a later copy's
 * title filling one the first lacked — at most `MAX_WEB_CITATIONS` in all.
 */
export const readUrlCitations = (
  ...annotationLists: unknown[]
): WebCitation[] => {
  const citations: WebCitation[] = []
  for (const annotations of annotationLists) {
    if (!Array.isArray(annotations)) continue
    for (const annotation of annotations) {
      const citation = readUrlCitation(annotation)
      if (!citation) continue
      const seen = citations.findIndex(({ url }) => url === citation.url)
      /** A repeat adds no source, but can name one that arrived untitled. */
      if (seen >= 0) {
        if (!citations[seen].title && citation.title) citations[seen] = citation
        continue
      }
      citations.push(citation)
      if (citations.length === MAX_WEB_CITATIONS) return citations
    }
  }
  return citations
}
