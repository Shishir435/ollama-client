import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import {
  createRouter,
  isOriginAllowed,
  matchRoute,
  sendJson,
  type RouteRequest
} from "../http.js"

describe("matchRoute", () => {
  it("matches fixed paths exactly", () => {
    expect(matchRoute("/v1/models", "/v1/models")).toEqual({})
    expect(matchRoute("/v1/models", "/v1/models/extra")).toBeNull()
    expect(matchRoute("/v1/models", "/v1")).toBeNull()
  })

  it("captures a single dynamic segment", () => {
    expect(matchRoute("/v1/models/:modelId", "/v1/models/gpt-4o")).toEqual({
      modelId: "gpt-4o"
    })
  })

  it("decodes an encoded segment so provider-prefixed ids survive", () => {
    expect(
      matchRoute(
        "/v1/models/:modelId",
        "/v1/models/opencode%2Flaguna-s-2.1-free"
      )
    ).toEqual({ modelId: "opencode/laguna-s-2.1-free" })
  })

  it("ignores trailing slashes", () => {
    expect(matchRoute("/health", "/health/")).toEqual({})
  })
})

describe("isOriginAllowed", () => {
  it("matches an exact origin", () => {
    expect(
      isOriginAllowed("http://localhost:3000", ["http://localhost:3000"])
    ).toBe(true)
    expect(
      isOriginAllowed("http://localhost:3001", ["http://localhost:3000"])
    ).toBe(false)
  })

  it("matches a whole scheme, because an extension id differs per install", () => {
    const allowed = ["chrome-extension://*"]
    expect(isOriginAllowed("chrome-extension://abcdef", allowed)).toBe(true)
    expect(isOriginAllowed("moz-extension://abcdef", allowed)).toBe(false)
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false)
  })

  it("allows everything only when explicitly configured", () => {
    expect(isOriginAllowed("https://evil.example", ["*"])).toBe(true)
    expect(isOriginAllowed("https://evil.example", [])).toBe(false)
  })
})

describe("router origin policy", () => {
  let server: Server | null = null

  const startServer = async (
    allowedOrigins: string[],
    rateLimit?: { limit: number; windowMs: number },
    authorize?: (request: RouteRequest) => boolean
  ) => {
    const router = createRouter({ allowedOrigins, rateLimit, authorize })
    router.post("/v1/chat/completions", (_request, response) =>
      sendJson(response, 200, { ok: true })
    )
    server = createServer((request, response) => {
      void router.handle(request, response)
    })
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve)
    )
    const { port } = server.address() as AddressInfo
    return `http://127.0.0.1:${port}`
  }

  const post = (url: string, headers: Record<string, string> = {}) =>
    fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: "{}"
    })

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()))
      server = null
    }
  })

  it("refuses a page origin before the route runs", async () => {
    const url = await startServer(["chrome-extension://*"])
    const response = await post(url, { Origin: "https://evil.example" })

    expect(response.status).toBe(403)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  it("refuses the preflight the same way", async () => {
    const url = await startServer(["chrome-extension://*"])
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST"
      }
    })

    expect(response.status).toBe(403)
  })

  it("echoes an allowed origin instead of a wildcard", async () => {
    const url = await startServer(["chrome-extension://*"])
    const response = await post(url, { Origin: "chrome-extension://abcdef" })

    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://abcdef"
    )
    expect(response.headers.get("vary")).toBe("Origin")
  })

  it("leaves a request without an origin alone", async () => {
    const url = await startServer([])
    const response = await post(url)

    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  it("returns machine-readable errors and rate-limit guidance", async () => {
    const url = await startServer([], { limit: 1, windowMs: 60_000 })

    const first = await fetch(`${url}/missing`)
    expect(first.status).toBe(404)
    expect(first.headers.get("content-type")).toContain("application/json")
    expect(first.headers.get("x-api-version")).toBe("1")
    expect(first.headers.get("ratelimit-remaining")).toBe("0")
    expect(await first.json()).toEqual({
      error: {
        type: "NotFound",
        code: "route_not_found",
        message: "No route for GET /missing.",
        resolution:
          "Use GET /, GET /health, GET /v1/models, or a documented /v1 endpoint."
      }
    })

    const limited = await fetch(`${url}/missing`)
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBeTruthy()
    const errorBody = (await limited.json()) as { error: { code: string } }
    expect(errorBody.error.code).toBe("rate_limit_exceeded")
  })

  it("does not let unauthorized traffic consume an authenticated bucket", async () => {
    const url = await startServer(
      [],
      { limit: 1, windowMs: 60_000 },
      (request) => request.headers.authorization === "Bearer valid"
    )

    const unauthorized = await post(url)
    expect(unauthorized.status).toBe(401)

    const authorized = await post(url, { Authorization: "Bearer valid" })
    expect(authorized.status).toBe(200)
    expect(authorized.headers.get("ratelimit-remaining")).toBe("0")
  })
})
