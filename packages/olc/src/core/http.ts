/**
 * Minimal HTTP router over `node:http`.
 *
 * Why not a framework: this proxy ships as a CLI, and its whole surface is six
 * routes, one of which streams server-sent events for up to half an hour. Keeping
 * the server in the standard library means the published package has exactly one
 * runtime dependency, and it keeps control of socket timeouts — which a long SSE
 * turn and a parked tool call both depend on — in one place.
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
  onRequest,
  authorize
}: {
  allowedHeaders?: string[]
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

    response.setHeader("Access-Control-Allow-Origin", "*")
    if (method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": allowedHeaders.join(", "),
        "Access-Control-Max-Age": "86400"
      })
      response.end()
      return
    }

    let body: unknown
    if (method === "POST") {
      try {
        body = await readJsonBody(request)
      } catch (error) {
        sendJson(response, 400, {
          error: { message: (error as Error).message, type: "BadRequest" }
        })
        return
      }
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
        body,
        raw: request
      }
      if (onRequest) onRequest(routeRequest, response)
      if (authorize && !authorize(routeRequest)) {
        sendJson(response, 401, { error: { message: "Unauthorized" } })
        return
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
              message: (error as Error).message,
              type: "InternalProxyError"
            }
          })
        } else {
          response.end()
        }
      }
      return
    }

    sendJson(response, 404, {
      error: { message: `No route for ${method} ${url.pathname}` }
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
