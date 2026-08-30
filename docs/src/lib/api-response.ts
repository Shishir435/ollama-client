const API_VERSION = "1"
const RATE_LIMIT = 60
const RATE_WINDOW_SECONDS = 60

export function apiHeaders(remaining = RATE_LIMIT, reset = RATE_WINDOW_SECONDS) {
  return {
    "Cache-Control": "public, max-age=60",
    "Content-Type": "application/json; charset=utf-8",
    "X-API-Version": API_VERSION,
    "RateLimit-Policy": `"default";q=${RATE_LIMIT};w=${RATE_WINDOW_SECONDS}`,
    "RateLimit": `"default";r=${Math.max(0, remaining)};t=${reset}`,
    "RateLimit-Limit": String(RATE_LIMIT),
    "RateLimit-Remaining": String(Math.max(0, remaining)),
    "RateLimit-Reset": String(reset)
  }
}

export function apiJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...apiHeaders(), ...extraHeaders }
  })
}

export function apiError(
  status: number,
  code: string,
  message: string,
  resolution: string
) {
  return apiJson(
    { error: { code, message, resolution } },
    status,
    status === 429 ? { "Retry-After": String(RATE_WINDOW_SECONDS) } : {}
  )
}
