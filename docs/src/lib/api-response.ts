/**
 * Response shaping for the website's read-only JSON API.
 *
 * Two callers share this module, and they must not drift:
 *
 *   - `src/pages/api.ts` / `src/pages/api-health.ts`, which Astro prerenders to
 *     static files. A static build keeps the body and throws the headers away,
 *     so `vercel.json` restates the header set for those two paths.
 *   - `proxy.ts`, the Routing Middleware, which answers the error cases a
 *     static file cannot answer at all: an unknown `/api/*` path, and any
 *     method other than GET/HEAD/OPTIONS.
 *
 * Everything an agent needs to self-throttle or recover is a header or a field
 * here, never prose in an HTML page.
 */
export const SITE_ORIGIN = "https://www.ollamaclient.in"

export const API_VERSION = "1"
export const API_VERSION_PATH = "v1"

/**
 * Published request budget for the website's discovery endpoints.
 *
 * The website serves static JSON from a CDN and does not meter callers, so
 * `RateLimit-Remaining` always reports a full window: it is the honest answer
 * to "have I been throttled", not a counter pretending to exist. The policy is
 * published so an agent can pace itself against a documented number instead of
 * guessing, and so the same conventions the local olc proxy enforces are
 * discoverable here.
 */
export const RATE_LIMIT = 60
export const RATE_WINDOW_SECONDS = 60

const DOCS_URL = `${SITE_ORIGIN}/developers/`
const OPENAPI_URL = `${SITE_ORIGIN}/openapi.json`
const CATALOG_URL = `${SITE_ORIGIN}/.well-known/api-catalog`
const AGENT_MAP_URL = `${SITE_ORIGIN}/llms.txt`

/**
 * Deprecation signalling contract, restated in every discovery payload.
 *
 * `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) are the headers a retiring
 * route will carry. `deprecation-policy` is not a registered relation type, so
 * it is expressed as an extension relation URI, which is what RFC 8288 requires
 * of anything outside the IANA registry.
 */
export const DEPRECATION_POLICY_URL = `${SITE_ORIGIN}/developers/#versioning-rate-limits-and-deprecation`
export const DEPRECATION_POLICY_REL = `${SITE_ORIGIN}/rel/deprecation-policy`

export const API_LINK_HEADER = [
  `<${OPENAPI_URL}>; rel="service-desc"; type="application/json"`,
  `<${DOCS_URL}>; rel="service-doc"; type="text/html"`,
  `<${CATALOG_URL}>; rel="api-catalog"`,
  `<${DEPRECATION_POLICY_URL}>; rel="${DEPRECATION_POLICY_REL}"`
].join(", ")

export const VERSIONING = {
  current: API_VERSION_PATH,
  scheme: "URL path versioning (/api for this site, /v1 for the local olc API)",
  versionHeader: "X-API-Version",
  deprecationHeaders: ["Deprecation", "Sunset"],
  minimumNoticeDays: 30,
  policy:
    "A route is never removed without notice. A deprecated route responds with the Deprecation header, a Sunset HTTP date at least 30 days ahead, and a Link to its replacement.",
  policyUrl: DEPRECATION_POLICY_URL
}

export const RATE_LIMIT_DOC = {
  policy: `${RATE_LIMIT} requests per ${RATE_WINDOW_SECONDS} seconds`,
  headers: [
    "RateLimit-Policy",
    "RateLimit",
    "RateLimit-Limit",
    "RateLimit-Remaining",
    "RateLimit-Reset"
  ],
  retry: "A 429 response carries Retry-After with the seconds to wait.",
  enforcement:
    "The website serves cached static JSON and does not meter callers; the published policy is the budget the local olc proxy enforces."
}

export function apiHeaders(
  remaining = RATE_LIMIT,
  reset = RATE_WINDOW_SECONDS
): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=60",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Accept, Accept-Encoding",
    "X-API-Version": API_VERSION,
    "Link": API_LINK_HEADER,
    "RateLimit-Policy": `"default";q=${RATE_LIMIT};w=${RATE_WINDOW_SECONDS}`,
    "RateLimit": `"default";r=${Math.max(0, remaining)};t=${reset}`,
    "RateLimit-Limit": String(RATE_LIMIT),
    "RateLimit-Remaining": String(Math.max(0, remaining)),
    "RateLimit-Reset": String(reset)
  }
}

export function apiErrorBody(
  status: number,
  code: string,
  message: string,
  resolution: string
) {
  return {
    error: {
      status,
      code,
      message,
      resolution,
      documentation: DOCS_URL,
      openapi: OPENAPI_URL,
      agentMap: AGENT_MAP_URL
    }
  }
}

export function apiJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: { ...apiHeaders(), ...extraHeaders }
  })
}

export function apiError(
  status: number,
  code: string,
  message: string,
  resolution: string,
  extraHeaders: Record<string, string> = {}
) {
  return apiJson(apiErrorBody(status, code, message, resolution), status, {
    ...(status === 429
      ? { "Retry-After": String(RATE_WINDOW_SECONDS) }
      : {}),
    ...extraHeaders
  })
}
