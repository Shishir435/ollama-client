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
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  })
  response.end(body)
}

export const startEventStream = (response: ServerResponse): void => {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  })
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

const applyOriginPolicy = (
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: string[]
): boolean => {
  const origin = request.headers.origin
  if (typeof origin !== "string" || origin === "") return true
  if (!isOriginAllowed(origin, allowedOrigins)) {
    sendJson(response, 403, {
      error: {
        message: `Origin ${origin} is not allowed to use this proxy`,
        type: "Forbidden"
      }
    })
    return false
  }
  response.setHeader("Access-Control-Allow-Origin", origin)
  response.setHeader("Vary", "Origin")
  return true
}

const handlePreflight = (
  method: string,
  response: ServerResponse,
  allowedHeaders: string[]
): boolean => {
  if (method !== "OPTIONS") return false
  response.writeHead(204, {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": allowedHeaders.join(", "),
    "Access-Control-Max-Age": "86400"
  })
  response.end()
  return true
}

const readRequestBody = async (
  method: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<{ ok: boolean; body?: unknown }> => {
  if (method !== "POST") return { ok: true }
  try {
    return { ok: true, body: await readJsonBody(request) }
  } catch (error) {
    sendJson(response, 400, {
      error: { message: (error as Error).message, type: "BadRequest" }
    })
    return { ok: false }
  }
}

const findMatchingRoute = (
  routes: Route[],
  patterns: Map<Route, string>,
  method: string,
  path: string
): { route: Route; params: Record<string, string> } | null => {
  for (const route of routes) {
    if (route.method !== method) continue
    const params = matchRoute(patterns.get(route) as string, path)
    if (params) return { route, params }
  }
  return null
}

const runRouteHandler = async (
  route: Route,
  routeRequest: RouteRequest,
  response: ServerResponse
): Promise<void> => {
  try {
    await route.handler(routeRequest, response)
  } catch (error) {
    console.error("[Proxy] Unhandled route error:", (error as Error).message)
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: {
          message: (error as Error).message,
          type: "InternalProxyError"
        }
      })
      return
    }
    response.end()
  }
}

export const createRouter = ({
  allowedHeaders = ["Content-Type", "Authorization"],
  allowedOrigins = [],
  onRequest,
  authorize
}: {
  allowedHeaders?: string[]
  /** Browser origins allowed to call this server. Empty means none. */
  allowedOrigins?: string[]
  onRequest?: (request: RouteRequest, response: ServerResponse) => void
  authorize?: (request: RouteRequest) => boolean
} = {}) => {
  const routes: Route[] = []
  const patterns = new Map<Route, string>()

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

    if (!applyOriginPolicy(request, response, allowedOrigins)) return
    if (handlePreflight(method, response, allowedHeaders)) return

    const bodyResult = await readRequestBody(method, request, response)
    if (!bodyResult.ok) return

    const match = findMatchingRoute(routes, patterns, method, url.pathname)
    if (!match) {
      sendJson(response, 404, {
        error: { message: `No route for ${method} ${url.pathname}` }
      })
      return
    }

    const routeRequest: RouteRequest = {
      method,
      path: url.pathname,
      params: match.params,
      query: url.searchParams,
      headers: request.headers,
      body: bodyResult.body,
      raw: request
    }
    if (onRequest) onRequest(routeRequest, response)
    if (authorize && !authorize(routeRequest)) {
      sendJson(response, 401, { error: { message: "Unauthorized" } })
      return
    }

    await runRouteHandler(match.route, routeRequest, response)
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
