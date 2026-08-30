/**
 * Minimal HTTP router over `node:http`.
 *
 * Why not a framework: this proxy ships as a CLI, and its whole surface is six
 * routes, one of which streams server-sent events for up to half an hour. Keeping
 * the server in the standard library means the published package has exactly one
 * runtime dependency, and it keeps control of socket timeouts — which a long SSE
 * turn and a parked tool call both depend on — in one place.
 *
 * Cross-origin policy: the proxy listens on loopback and runs an agent, so a page in
 * the user's browser must not be able to drive it. An `Origin` this server does not
 * know is refused before the route runs — a wildcard would let any site spend a turn
 * with a simple request, which no missing response header prevents.
 */
import type { IncomingMessage, ServerResponse } from "node:http"

const JSON_BODY_LIMIT_BYTES = 50 * 1024 * 1024

export interface RouteRequest {
  method: string
  path: string
  params: Record<string, string>
  query: URLSearchParams
  headers: IncomingMessage["headers"]
  body: unknown
  raw: IncomingMessage
}

export type RouteHandler = (
  request: RouteRequest,
  response: ServerResponse
) => void | Promise<void>

export interface RateLimitConfig {
  limit: number
  windowMs: number
}

interface Route {
  method: string
  segments: string[]
  handler: RouteHandler
}

export const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void => {
  if (response.writableEnded) return
  const body = JSON.stringify(payload)
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.setHeader("Content-Length", Buffer.byteLength(body))
  if (!response.hasHeader("X-API-Version"))
    response.setHeader("X-API-Version", "1")
  if (!response.hasHeader("RateLimit-Policy"))
    response.setHeader("RateLimit-Policy", '"default";q=60;w=60')
  if (!response.hasHeader("RateLimit"))
    response.setHeader("RateLimit", '"default";r=60;t=60')
  if (!response.hasHeader("RateLimit-Limit"))
    response.setHeader("RateLimit-Limit", "60")
  if (!response.hasHeader("RateLimit-Remaining"))
    response.setHeader("RateLimit-Remaining", "60")
  if (!response.hasHeader("RateLimit-Reset"))
    response.setHeader("RateLimit-Reset", "60")
  response.writeHead(statusCode)
  response.end(body)
}

export const startEventStream = (response: ServerResponse): void => {
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8")
  response.setHeader("Cache-Control", "no-cache")
  response.setHeader("Connection", "keep-alive")
  response.setHeader("X-Accel-Buffering", "no")
  if (!response.hasHeader("X-API-Version"))
    response.setHeader("X-API-Version", "1")
  if (!response.hasHeader("RateLimit-Policy"))
    response.setHeader("RateLimit-Policy", '"default";q=60;w=60')
  if (!response.hasHeader("RateLimit"))
    response.setHeader("RateLimit", '"default";r=60;t=60')
  if (!response.hasHeader("RateLimit-Limit"))
    response.setHeader("RateLimit-Limit", "60")
  if (!response.hasHeader("RateLimit-Remaining"))
    response.setHeader("RateLimit-Remaining", "60")
  if (!response.hasHeader("RateLimit-Reset"))
    response.setHeader("RateLimit-Reset", "60")
  response.writeHead(200)
  if (typeof response.flushHeaders === "function") response.flushHeaders()
}

/**
 * Match a request path against a registered route pattern.
 *
 * Patterns use `:name` for one path segment; nothing else is supported, because
 * every route here is either fixed or a single model id.
 */
export const matchRoute = (
  pattern: string,
  path: string
): Record<string, string> | null => {
  const patternSegments = pattern.split("/").filter(Boolean)
  const pathSegments = path.split("/").filter(Boolean)
  if (patternSegments.length !== pathSegments.length) return null

  const params: Record<string, string> = {}
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index] as string
    const actual = pathSegments[index] as string
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual)
      continue
    }
    if (expected !== actual) return null
  }
  return params
}

/**
 * Whether a browser origin may talk to this proxy.
 *
 * Entries are exact origins, `<scheme>://*` for a whole scheme, or `*` for everything.
 * The scheme form is what makes the default workable: an extension's origin carries
 * its own id, which differs per install and per browser.
 */
export const isOriginAllowed = (
  origin: string,
  allowedOrigins: string[]
): boolean => {
  for (const entry of allowedOrigins) {
    if (entry === "*" || entry === origin) return true
    if (entry.endsWith("://*") && origin.startsWith(entry.slice(0, -1))) {
      return true
    }
  }
  return false
}

const readJsonBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > JSON_BODY_LIMIT_BYTES) {
        reject(new Error("Request body is too large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${(error as Error).message}`))
      }
    })
    request.on("error", reject)
  })

export const createRouter = ({
  allowedHeaders = ["Content-Type", "Authorization"],
  allowedOrigins = [],
  onRequest,
  authorize,
  rateLimit = { limit: 60, windowMs: 60_000 }
}: {
  allowedHeaders?: string[]
  /** Browser origins allowed to call this server. Empty means none. */
  allowedOrigins?: string[]
  onRequest?: (request: RouteRequest, response: ServerResponse) => void
  authorize?: (request: RouteRequest) => boolean
  rateLimit?: RateLimitConfig
} = {}) => {
  const routes: Route[] = []
  const patterns = new Map<Route, string>()
  const buckets = new Map<string, { count: number; resetAt: number }>()

  const setRateLimitHeaders = (
    response: ServerResponse,
    remaining: number,
    resetAt: number
  ) => {
    const resetSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
    response.setHeader(
      "RateLimit-Policy",
      `"default";q=${rateLimit.limit};w=${Math.ceil(rateLimit.windowMs / 1000)}`
    )
    response.setHeader(
      "RateLimit",
      `"default";r=${Math.max(0, remaining)};t=${resetSeconds}`
    )
    response.setHeader("RateLimit-Limit", String(rateLimit.limit))
    response.setHeader("RateLimit-Remaining", String(Math.max(0, remaining)))
    response.setHeader("RateLimit-Reset", String(resetSeconds))
    response.setHeader("X-API-Version", "1")
  }

  const register = (method: string, pattern: string, handler: RouteHandler) => {
    const route: Route = {
      method,
      segments: pattern.split("/").filter(Boolean),
      handler
    }
    patterns.set(route, pattern)
    routes.push(route)
  }

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost")
    const method = (request.method ?? "GET").toUpperCase()

    // A request without an `Origin` is not from a page: a CLI, a script, or the
    // extension's own background fetch. Only a browser origin is gated here.
    const origin = request.headers.origin
    if (typeof origin === "string" && origin !== "") {
      if (!isOriginAllowed(origin, allowedOrigins)) {
        sendJson(response, 403, {
          error: {
            type: "Forbidden",
            code: "origin_not_allowed",
            message: `Origin ${origin} is not allowed to use this proxy.`,
            resolution: "Add the exact trusted origin to --allowed-origins."
          }
        })
        return
      }
      response.setHeader("Access-Control-Allow-Origin", origin)
      response.setHeader("Vary", "Origin")
    }

    if (method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": allowedHeaders.join(", "),
        "Access-Control-Max-Age": "86400",
        "X-API-Version": "1",
        "RateLimit-Policy": '"default";q=60;w=60',
        RateLimit: '"default";r=60;t=60',
        "RateLimit-Limit": "60",
        "RateLimit-Remaining": "60",
        "RateLimit-Reset": "60"
      })
      response.end()
      return
    }

    for (const route of routes) {
      if (route.method !== method) continue
      const params = matchRoute(patterns.get(route) as string, url.pathname)
      if (!params) continue

      const routeRequest: RouteRequest = {
        method,
        path: url.pathname,
        params,
        query: url.searchParams,
        headers: request.headers,
        body: undefined,
        raw: request
      }
      if (onRequest) onRequest(routeRequest, response)
      if (authorize && !authorize(routeRequest)) {
        sendJson(response, 401, {
          error: {
            type: "Unauthorized",
            code: "unauthorized",
            message: "Bearer authentication failed.",
            resolution:
              "Supply Authorization: Bearer <token>, or remove the configured API key."
          }
        })
        return
      }

      const bucketKey =
        request.headers.authorization ||
        request.socket.remoteAddress ||
        "anonymous"
      const now = Date.now()
      const previous = buckets.get(bucketKey)
      const bucket =
        !previous || previous.resetAt <= now
          ? { count: 0, resetAt: now + rateLimit.windowMs }
          : previous
      bucket.count += 1
      buckets.set(bucketKey, bucket)
      setRateLimitHeaders(
        response,
        rateLimit.limit - bucket.count,
        bucket.resetAt
      )
      if (bucket.count > rateLimit.limit) {
        const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
        response.setHeader("Retry-After", String(retryAfter))
        sendJson(response, 429, {
          error: {
            type: "RateLimitExceeded",
            code: "rate_limit_exceeded",
            message: "Request rate limit exceeded.",
            resolution: `Wait ${retryAfter} seconds, then retry with backoff.`
          }
        })
        return
      }

      if (method === "POST") {
        try {
          routeRequest.body = await readJsonBody(request)
        } catch (error) {
          sendJson(response, 400, {
            error: {
              type: "BadRequest",
              code: "invalid_json",
              message: (error as Error).message,
              resolution: "Send valid JSON with Content-Type application/json."
            }
          })
          return
        }
      }

      try {
        await route.handler(routeRequest, response)
      } catch (error) {
        console.error(
          "[Proxy] Unhandled route error:",
          (error as Error).message
        )
        if (!response.headersSent) {
          sendJson(response, 500, {
            error: {
              type: "InternalProxyError",
              code: "internal_proxy_error",
              message: (error as Error).message,
              resolution: "Inspect local olc logs and retry only when safe."
            }
          })
        } else {
          response.end()
        }
      }
      return
    }

    const bucketKey =
      request.headers.authorization ||
      request.socket.remoteAddress ||
      "anonymous"
    const now = Date.now()
    const previous = buckets.get(bucketKey)
    const bucket =
      !previous || previous.resetAt <= now
        ? { count: 0, resetAt: now + rateLimit.windowMs }
        : previous
    bucket.count += 1
    buckets.set(bucketKey, bucket)
    setRateLimitHeaders(response, rateLimit.limit - bucket.count, bucket.resetAt)
    sendJson(response, 404, {
      error: {
        type: "NotFound",
        code: "route_not_found",
        message: `No route for ${method} ${url.pathname}.`,
        resolution:
          "Use GET /, GET /health, GET /v1/models, or a documented /v1 endpoint."
      }
    })
  }

  return {
    get: (pattern: string, handler: RouteHandler) =>
      register("GET", pattern, handler),
    post: (pattern: string, handler: RouteHandler) =>
      register("POST", pattern, handler),
    handle
  }
}

export type Router = ReturnType<typeof createRouter>
