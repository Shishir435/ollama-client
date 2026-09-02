import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  NON_NEGOTIABLE_ROUTES,
  notFoundMarkdown,
  parseAccept,
  preferredRepresentation,
  resolveRequest
} from "../../../docs/src/lib/agent-routing"
import {
  API_LINK_HEADER,
  apiHeaders,
  RATE_LIMIT,
  SITE_ORIGIN
} from "../../../docs/src/lib/api-response"

const REPO_ROOT = join(__dirname, "../../..")
const readRepoFile = (path: string) =>
  readFileSync(join(REPO_ROOT, path), "utf-8")

const MARKDOWN_SLUGS = [
  "developers",
  "guides/quick-start",
  "guides/troubleshooting/error-reports"
]

const resolve = (
  pathname: string,
  accept: string | null = null,
  method = "GET"
) =>
  resolveRequest({
    pathname,
    method,
    accept,
    markdownSlugs: MARKDOWN_SLUGS
  })

describe("Accept parsing", () => {
  it("reads quality factors and specificity", () => {
    expect(parseAccept("text/markdown")).toEqual([
      { type: "text", subtype: "markdown", q: 1, specificity: 2 }
    ])
    expect(parseAccept("text/*;q=0.4")).toEqual([
      { type: "text", subtype: "*", q: 0.4, specificity: 1 }
    ])
    expect(parseAccept("*/*")).toEqual([
      { type: "*", subtype: "*", q: 1, specificity: 0 }
    ])
  })

  it("drops entries it cannot read instead of failing the header", () => {
    expect(parseAccept("garbage, text/markdown;q=nope, text/html")).toEqual([
      { type: "text", subtype: "markdown", q: 1, specificity: 2 },
      { type: "text", subtype: "html", q: 1, specificity: 2 }
    ])
  })

  it("ignores a q outside the legal range", () => {
    expect(parseAccept("text/markdown;q=5")[0].q).toBe(1)
  })
})

describe("representation preference", () => {
  it("keeps HTML for a browser and for a caller with no preference", () => {
    expect(
      preferredRepresentation(
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      )
    ).toBe("html")
    expect(preferredRepresentation(null)).toBe("html")
    expect(preferredRepresentation("*/*")).toBe("html")
  })

  it("serves Markdown when it is asked for by name", () => {
    expect(preferredRepresentation("text/markdown")).toBe("markdown")
    expect(preferredRepresentation("text/markdown, text/html;q=0.5")).toBe(
      "markdown"
    )
  })

  it("honours a quality factor that ranks HTML higher", () => {
    expect(
      preferredRepresentation("text/markdown;q=0.5, text/html;q=0.9")
    ).toBe("html")
  })

  it("breaks a tie towards the range named explicitly", () => {
    expect(preferredRepresentation("text/markdown, text/*")).toBe("markdown")
    expect(preferredRepresentation("text/html, text/*")).toBe("html")
  })

  it("lets an explicit exclusion outrank a permissive wildcard", () => {
    /*
     * RFC 9110 resolves a type's quality with the most specific matching range.
     * Ranking by quality alone would serve the exact thing the client just
     * excluded, because the wildcard beside it carries a higher q.
     */
    expect(preferredRepresentation("text/html;q=0, */*;q=1")).toBe("markdown")
    expect(preferredRepresentation("text/markdown;q=0, */*;q=1")).toBe("html")
    expect(preferredRepresentation("text/html;q=0, text/*;q=1")).toBe(
      "markdown"
    )
  })

  it("reports an Accept header nothing satisfies", () => {
    expect(preferredRepresentation("application/xml")).toBe("unacceptable")
    expect(preferredRepresentation("text/html;q=0, text/markdown;q=0")).toBe(
      "unacceptable"
    )
  })
})

describe("Markdown negotiation", () => {
  it("serves the Markdown twin of a documentation page at the same URL", () => {
    expect(resolve("/developers", "text/markdown")).toEqual({
      kind: "rewrite",
      destination: "/developers.md"
    })
    expect(resolve("/guides/quick-start/", "text/markdown")).toEqual({
      kind: "rewrite",
      destination: "/guides/quick-start.md"
    })
  })

  it("serves the landing page's twin for the site root", () => {
    expect(resolve("/", "text/markdown")).toEqual({
      kind: "rewrite",
      destination: "/index.md"
    })
  })

  it("leaves the HTML representation alone for every other caller", () => {
    expect(resolve("/developers", "text/html")).toEqual({ kind: "pass" })
    expect(resolve("/developers", null)).toEqual({ kind: "pass" })
  })

  it("passes through a page that exists without a Markdown twin", () => {
    for (const route of NON_NEGOTIABLE_ROUTES) {
      expect(resolve(`/${route}`, "text/markdown")).toEqual({ kind: "pass" })
      expect(resolve(`/${route}/lib/providers`, "text/markdown")).toEqual({
        kind: "pass"
      })
    }
  })

  it("answers 406 when no available representation matches", () => {
    const decision = resolve("/developers", "application/xml")

    expect(decision).toMatchObject({ kind: "respond", status: 406 })
    if (decision.kind !== "respond") throw new Error("expected a response")
    expect(decision.headers["Content-Type"]).toBe(
      "application/json; charset=utf-8"
    )
    expect(JSON.parse(decision.body).error.code).toBe("not_acceptable")
  })
})

describe("404 handling", () => {
  it("returns a Markdown recovery map to a Markdown client", () => {
    const decision = resolve("/does-not-exist", "text/markdown")

    expect(decision).toMatchObject({ kind: "respond", status: 404 })
    if (decision.kind !== "respond") throw new Error("expected a response")
    expect(decision.headers["Content-Type"]).toBe(
      "text/markdown; charset=utf-8"
    )
    expect(decision.headers.Vary).toContain("Accept")
    expect(decision.body).toContain("# 404")
    for (const link of [
      `${SITE_ORIGIN}/llms.txt`,
      `${SITE_ORIGIN}/sitemap-index.xml`,
      `${SITE_ORIGIN}/developers/`,
      `${SITE_ORIGIN}/.well-known/api-catalog`
    ]) {
      expect(decision.body).toContain(link)
    }
  })

  it("leaves an HTML client on the rendered 404 page", () => {
    expect(resolve("/does-not-exist", "text/html")).toEqual({ kind: "pass" })
  })

  it("publishes the same recovery map as the static /404.md", () => {
    /*
     * `docs/public` is generated and gitignored, so the artifact itself cannot
     * be read here. What matters is that one string feeds both surfaces: the
     * generator writes `notFoundMarkdown()` verbatim, and the rendered 404 page
     * prints the same call.
     */
    expect(readRepoFile("tools/generate/generate-llms-docs.ts")).toContain(
      'writeFileSync(join(PUBLIC_DIR, "404.md"), notFoundMarkdown(), "utf-8")'
    )
    expect(readRepoFile("docs/src/pages/404.astro")).toContain(
      "{notFoundMarkdown()}"
    )
  })
})

describe("JSON API errors", () => {
  it("passes a read of a published endpoint through to its static JSON", () => {
    expect(resolve("/api")).toEqual({ kind: "pass" })
    expect(resolve("/api/health")).toEqual({ kind: "pass" })
    expect(resolve("/api/health/", null, "HEAD")).toEqual({ kind: "pass" })
  })

  it("answers an unknown API path with JSON, whatever the Accept header", () => {
    for (const accept of [
      null,
      "text/html",
      "text/markdown",
      "application/xml"
    ]) {
      const decision = resolve("/api/models", accept)

      expect(decision).toMatchObject({ kind: "respond", status: 404 })
      if (decision.kind !== "respond") throw new Error("expected a response")
      const body = JSON.parse(decision.body)
      expect(body.error.code).toBe("route_not_found")
      expect(body.error.resolution).toBeTruthy()
      expect(body.error.documentation).toBe(`${SITE_ORIGIN}/developers/`)
      expect(decision.headers["Content-Type"]).toBe(
        "application/json; charset=utf-8"
      )
    }
  })

  it("answers a write with 405 and names the methods it accepts", () => {
    const decision = resolve("/api", "application/json", "POST")

    expect(decision).toMatchObject({ kind: "respond", status: 405 })
    if (decision.kind !== "respond") throw new Error("expected a response")
    expect(decision.headers.Allow).toBe("GET, HEAD, OPTIONS")
    expect(JSON.parse(decision.body).error.code).toBe("method_not_allowed")
  })

  it("answers a preflight without a body or a content type", () => {
    const decision = resolve("/api", null, "OPTIONS")

    expect(decision).toMatchObject({ kind: "respond", status: 204, body: "" })
    if (decision.kind !== "respond") throw new Error("expected a response")
    expect(decision.headers["Content-Type"]).toBeUndefined()
    expect(decision.headers.Allow).toBe("GET, HEAD, OPTIONS")
    expect(decision.headers["RateLimit-Limit"]).toBe(String(RATE_LIMIT))
  })

  it("carries the rate-limit contract on every JSON answer", () => {
    const decision = resolve("/api/models")

    if (decision.kind !== "respond") throw new Error("expected a response")
    expect(decision.headers["RateLimit-Limit"]).toBe(String(RATE_LIMIT))
    expect(decision.headers["RateLimit-Policy"]).toBe(
      `"default";q=${RATE_LIMIT};w=60`
    )
    expect(decision.headers["RateLimit-Remaining"]).toBe(String(RATE_LIMIT))
    expect(decision.headers["RateLimit-Reset"]).toBe("60")
    expect(decision.headers["X-API-Version"]).toBe("1")
    expect(decision.headers.Link).toBe(API_LINK_HEADER)
  })
})

describe("published header contract", () => {
  /*
   * A static Astro build keeps an endpoint's body and discards the headers its
   * module set, so `vercel.json` restates them for the two prerendered API
   * paths. Two copies of a header set drift; this is the check that they have
   * not.
   */
  it("restates the API headers in vercel.json exactly as the module builds them", () => {
    const config = JSON.parse(readRepoFile("vercel.json")) as {
      headers: Array<{
        source: string
        headers: Array<{ key: string; value: string }>
      }>
    }
    const expected = apiHeaders()

    for (const source of ["/api", "/api/health"]) {
      const rule = config.headers.find((entry) => entry.source === source)
      expect(rule, source).toBeDefined()
      const declared = Object.fromEntries(
        (rule?.headers ?? []).map(({ key, value }) => [key, value])
      )

      for (const key of [
        "Content-Type",
        "X-API-Version",
        "Link",
        "RateLimit-Policy",
        "RateLimit",
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset"
      ]) {
        expect(declared[key], `${source} ${key}`).toBe(expected[key])
      }
    }
  })

  it("names both API surfaces and the deprecation policy in the Link header", () => {
    expect(API_LINK_HEADER).toContain('rel="service-desc"')
    expect(API_LINK_HEADER).toContain('rel="service-doc"')
    expect(API_LINK_HEADER).toContain('rel="api-catalog"')
    expect(API_LINK_HEADER).toContain("rel/deprecation-policy")
  })
})
