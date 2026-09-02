/**
 * Request-time routing decisions for agent clients.
 *
 * The site is statically built, and Vercel evaluates `vercel.json` rewrites
 * *after* the filesystem: a rewrite can never reshape a response for a path
 * that exists as a file, which is every documentation page. Content
 * negotiation, a machine-readable 404 and JSON API errors therefore have to be
 * decided before the filesystem, in Routing Middleware.
 *
 * This module is the whole decision; `proxy.ts` only turns a decision into a
 * `Response`. Keeping the two apart is what makes the behaviour testable
 * without a deployment.
 */
import {
  API_LINK_HEADER,
  apiErrorBody,
  apiHeaders,
  SITE_ORIGIN
} from "./api-response.js"

/** Media type of the Markdown variant, per RFC 7763. */
export const MARKDOWN_TYPE = "text/markdown; charset=utf-8"

export type RouteDecision =
  /** Hand the request to normal static serving. */
  | { kind: "pass" }
  /** Serve a different path's bytes under the requested URL. */
  | { kind: "rewrite"; destination: string }
  /** Answer here; static serving never runs. */
  | {
      kind: "respond"
      status: number
      headers: Record<string, string>
      body: string
    }

export type ResolveInput = {
  pathname: string
  method: string
  accept: string | null
  /** Slugs with a published `.md` twin, i.e. `DOC_ORDER`. */
  markdownSlugs: readonly string[]
}

/**
 * Extension-less routes that exist but have no Markdown twin.
 *
 * Negotiation has to tell "this page has no Markdown form" apart from "this
 * path does not exist": answering 404 for a page a client can plainly load as
 * HTML would be a lie, and the recovery links would send it somewhere it had
 * already been. The generated TypeDoc reference is published but not part of
 * the Markdown IA (it carries no descriptions and is `noindex`), and
 * `/goodbye` is the post-uninstall destination.
 */
export const NON_NEGOTIABLE_ROUTES = ["reference", "goodbye"] as const

type MediaRange = {
  type: string
  subtype: string
  q: number
  /** 2 for an exact type, 1 for a subtype wildcard, 0 for a full wildcard. */
  specificity: number
}

/**
 * Parse an `Accept` header into ranges with their quality factors.
 *
 * A malformed parameter is dropped rather than failing the whole header: a
 * client that sends one still deserves its readable ranges honoured. A `q`
 * outside `[0, 1]` is not a preference, so it is ignored too.
 */
export function parseAccept(header: string | null): MediaRange[] {
  if (!header) return []

  const ranges: MediaRange[] = []

  for (const entry of header.split(",")) {
    const [rawRange, ...params] = entry.split(";")
    const range = rawRange.trim().toLowerCase()
    if (!range) continue

    const [type, subtype] = range.split("/")
    if (!type || !subtype) continue

    let q = 1
    for (const param of params) {
      const match = param.trim().match(/^q=([0-9]*\.?[0-9]+)$/i)
      if (!match) continue
      const parsed = Number.parseFloat(match[1])
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) q = parsed
    }

    ranges.push({
      type,
      subtype,
      q,
      specificity: type === "*" ? 0 : subtype === "*" ? 1 : 2
    })
  }

  return ranges
}

const scoreFor = (ranges: MediaRange[], type: string, subtype: string) =>
  ranges
    .filter(
      (range) =>
        (range.type === "*" || range.type === type) &&
        (range.subtype === "*" || range.subtype === subtype)
    )
    .reduce(
      (best, range) =>
        range.q > best.q ||
        (range.q === best.q && range.specificity > best.specificity)
          ? { q: range.q, specificity: range.specificity }
          : best,
      { q: 0, specificity: -1 }
    )

export type Preference = "markdown" | "html" | "unacceptable"

/**
 * Pick the representation to serve.
 *
 * Markdown wins only when the client asked for it more strongly than HTML, or
 * asked for it by name while reaching HTML through a wildcard. A browser sends
 * `text/html,…,<full wildcard>;q=0.8`, which keeps HTML; `Accept: text/markdown` alone
 * flips it. No `Accept` header at all is not a preference — it means "anything"
 * (RFC 9110), so it keeps the default HTML representation.
 */
export function preferredRepresentation(accept: string | null): Preference {
  const ranges = parseAccept(accept)
  if (ranges.length === 0) return "html"

  const markdown = scoreFor(ranges, "text", "markdown")
  const html = scoreFor(ranges, "text", "html")

  if (markdown.q === 0 && html.q === 0) return "unacceptable"
  if (markdown.q === 0) return "html"
  if (markdown.q > html.q) return "markdown"
  if (markdown.q < html.q) return "html"
  return markdown.specificity > html.specificity ? "markdown" : "html"
}

/** Strip the trailing slash so `/developers` and `/developers/` are one page. */
const slugOf = (pathname: string) =>
  pathname.replace(/^\/+/, "").replace(/\/+$/, "")

const NOT_FOUND_MARKDOWN = `# 404 — Ollama Client page not found

The requested path does not exist on this site. It is a documentation host, so
nothing is generated on demand — every published page is listed in the maps
below.

- Home: ${SITE_ORIGIN}/
- Agent map: ${SITE_ORIGIN}/llms.txt
- Full Markdown docs: ${SITE_ORIGIN}/llms-full.txt
- Sitemap: ${SITE_ORIGIN}/sitemap-index.xml
- Developer portal: ${SITE_ORIGIN}/developers/
- OpenAPI: ${SITE_ORIGIN}/openapi.json
- API catalog: ${SITE_ORIGIN}/.well-known/api-catalog
`

const markdownHeaders = (): Record<string, string> => ({
  "Content-Type": MARKDOWN_TYPE,
  "Vary": "Accept, Accept-Encoding",
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Link": API_LINK_HEADER
})

/** Paths whose JSON is prerendered; everything else under /api is unknown. */
const API_PATHS = new Set(["/api", "/api/health"])

const READ_METHODS = new Set(["GET", "HEAD"])

const jsonDecision = (
  status: number,
  code: string,
  message: string,
  resolution: string,
  extraHeaders: Record<string, string> = {}
): RouteDecision => ({
  kind: "respond",
  status,
  headers: { ...apiHeaders(), ...extraHeaders },
  body: `${JSON.stringify(apiErrorBody(status, code, message, resolution), null, 2)}\n`
})

const resolveApi = (pathname: string, method: string): RouteDecision => {
  if (method === "OPTIONS") {
    /*
     * A 204 carries no representation, so it carries no `Content-Type` either.
     * The rate-limit and versioning headers stay: a client probing what a route
     * accepts is exactly the one that should learn its budget before spending
     * it.
     */
    const { "Content-Type": _contentType, ...headers } = apiHeaders()
    return {
      kind: "respond",
      status: 204,
      headers: { ...headers, Allow: "GET, HEAD, OPTIONS" },
      body: ""
    }
  }

  if (!API_PATHS.has(pathname)) {
    return jsonDecision(
      404,
      "route_not_found",
      `No API route for ${method} ${pathname}.`,
      "This site publishes GET /api and GET /api/health. Inference endpoints live on the local olc proxy described by the OpenAPI document."
    )
  }

  if (!READ_METHODS.has(method)) {
    return jsonDecision(
      405,
      "method_not_allowed",
      `${method} is not supported by this read-only endpoint.`,
      "Use GET. The website publishes discovery metadata only; send generation requests to your local olc proxy.",
      { Allow: "GET, HEAD, OPTIONS" }
    )
  }

  return { kind: "pass" }
}

/**
 * Decide how one request is answered.
 *
 * Order matters. `/api` is settled first so an agent probing it always gets
 * JSON, whatever it put in `Accept`; a 406 there would be an HTML-shaped answer
 * to a machine question.
 */
export function resolveRequest({
  pathname,
  method,
  accept,
  markdownSlugs
}: ResolveInput): RouteDecision {
  const normalized = pathname.replace(/\/{2,}/g, "/")

  if (normalized === "/api" || normalized.startsWith("/api/")) {
    return resolveApi(normalized.replace(/\/$/, "") || "/api", method)
  }

  const preference = preferredRepresentation(accept)

  if (preference === "unacceptable") {
    return jsonDecision(
      406,
      "not_acceptable",
      "No representation matches the Accept header.",
      "Request text/html for the rendered page, text/markdown for the Markdown twin, or */* to accept the default."
    )
  }

  if (preference === "html") return { kind: "pass" }

  const slug = slugOf(normalized)
  if (slug === "") return { kind: "rewrite", destination: "/index.md" }
  if (markdownSlugs.includes(slug)) {
    return { kind: "rewrite", destination: `/${slug}.md` }
  }
  if (
    NON_NEGOTIABLE_ROUTES.some(
      (route) => slug === route || slug.startsWith(`${route}/`)
    )
  ) {
    return { kind: "pass" }
  }

  return {
    kind: "respond",
    status: 404,
    headers: markdownHeaders(),
    body: NOT_FOUND_MARKDOWN
  }
}

export const notFoundMarkdown = () => NOT_FOUND_MARKDOWN
