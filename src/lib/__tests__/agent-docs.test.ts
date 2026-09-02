import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { OLC_PUBLIC_ROUTES } from "../../../packages/olc/src/core/public-api-contract"
import {
  apiCatalogDocument,
  llmsTxtContent
} from "../../../tools/generate/generate-llms-docs"
import { buildOlcOpenApi } from "../../../tools/generate/generate-openapi"

const REPO_ROOT = join(__dirname, "../../..")
const readRepoFile = (path: string) =>
  readFileSync(join(REPO_ROOT, path), "utf-8")

const openApi = buildOlcOpenApi() as {
  openapi: string
  components: unknown
  info: { title: string; version: string; description: string }
  servers: Array<{ url: string }>
  paths: Record<
    string,
    Record<
      string,
      {
        operationId?: string
        description?: string
        parameters?: Array<{ schema?: unknown; $ref?: string }>
        requestBody?: { schema?: unknown; $ref?: string }
        responses?: Record<string, unknown>
      }
    >
  >
}

/**
 * Resolve one local `$ref` so an assertion reads the shape a client would.
 *
 * Only the single hop the document actually uses is followed: components here
 * never point at further refs, and a general resolver would hide a chain that
 * does not exist.
 */
type OpenApiNode = {
  $ref?: string
  schema?: unknown
  headers?: Record<string, unknown>
  content?: Record<string, { schema?: unknown }>
}

const deref = (node: OpenApiNode): OpenApiNode => {
  if (!node.$ref) return node
  const path = node.$ref.replace(/^#\//, "").split("/")
  return path.reduce<Record<string, unknown>>(
    (current, key) => current[key] as Record<string, unknown>,
    openApi as unknown as Record<string, unknown>
  ) as OpenApiNode
}

describe("agent-facing documentation", () => {
  it("publishes a function-calling-compatible local OpenAPI surface", () => {
    const packageVersion = JSON.parse(
      readRepoFile("packages/olc/package.json")
    ).version
    const operations = Object.values(openApi.paths).flatMap((path) =>
      Object.values(path)
    )
    const operationIds = operations.map((operation) => operation.operationId)

    expect(openApi.openapi).toBe("3.1.0")
    expect(openApi.info.title).toContain("Ollama Client")
    expect(openApi.info.version).toBe(packageVersion)
    expect(openApi.info.description).toContain("does not host")
    expect(Object.keys(openApi.paths)).toEqual([
      OLC_PUBLIC_ROUTES.serviceInfo,
      OLC_PUBLIC_ROUTES.health,
      OLC_PUBLIC_ROUTES.models,
      OLC_PUBLIC_ROUTES.model.replace(":modelId", "{modelId}"),
      OLC_PUBLIC_ROUTES.chatCompletions,
      OLC_PUBLIC_ROUTES.imageGenerations
    ])
    expect(openApi.servers).not.toHaveLength(0)
    expect(
      openApi.servers.every(({ url }) =>
        /^http:\/\/(127\.0\.0\.1|localhost)/.test(url)
      )
    ).toBe(true)
    expect(operationIds.every(Boolean)).toBe(true)
    expect(new Set(operationIds).size).toBe(operationIds.length)
    expect(
      operations.every((operation) => Boolean(operation.description))
    ).toBe(true)
    expect(operations.every((operation) => Boolean(operation.responses))).toBe(
      true
    )
    expect(
      operations
        .flatMap((operation) => operation.parameters ?? [])
        .every((parameter) => Boolean(deref(parameter).schema))
    ).toBe(true)
  })

  it("gives every operation a typed input and a documented rate limit", () => {
    /*
     * A function-calling client builds its tool schema from an operation's
     * inputs. Three of the six had none at all — no path parameter and no
     * request body — which reads as an untyped tool rather than one that takes
     * nothing. Every operation now documents the `Origin` header the proxy
     * actually inspects, which is a real input and the reason each can answer
     * 403.
     */
    const operations = Object.values(openApi.paths).flatMap((path) =>
      Object.values(path)
    )

    for (const operation of operations) {
      const parameterSchemas = (operation.parameters ?? []).map(
        (parameter) => deref(parameter).schema
      )
      const bodySchemas = Object.values(
        deref(operation.requestBody ?? {}).content ?? {}
      ).map((media) => media.schema)
      const inputs = [...parameterSchemas, ...bodySchemas]

      expect(inputs.length, operation.operationId).toBeGreaterThan(0)
      expect(inputs.every(Boolean), operation.operationId).toBe(true)
      expect(operation.responses?.["429"], operation.operationId).toBeDefined()
    }

    const rateLimited = deref({
      $ref: "#/components/responses/RateLimitExceeded"
    })

    expect(Object.keys(rateLimited.headers ?? {})).toEqual(
      expect.arrayContaining([
        "Retry-After",
        "RateLimit-Policy",
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
        "Deprecation",
        "Sunset"
      ])
    )
  })

  it("keeps trust pages substantive and product-specific", () => {
    for (const path of [
      "docs/src/content/docs/about.md",
      "docs/src/content/docs/contact.md",
      "docs/src/content/docs/legal/privacy-policy.md"
    ]) {
      const content = readRepoFile(path)
      const body = content.replace(/^---\n[\s\S]*?\n---\n/, "").trim()

      expect(body.length, path).toBeGreaterThanOrEqual(500)
      expect(content, path).toContain("Ollama Client")
    }
  })

  it("routes Accept negotiation through middleware, not a post-filesystem rewrite", () => {
    /*
     * Vercel evaluates `rewrites` after the filesystem, so the rule this
     * replaced could never fire for a documentation page: every one of them is
     * a built file. What shipped instead was a header rule that stamped
     * `Content-Type: text/markdown` on the HTML body it failed to replace.
     * Negotiation belongs in Routing Middleware, which runs first.
     */
    const config = JSON.parse(readRepoFile("vercel.json")) as {
      proxy?: { entrypoint: string }
      rewrites: Array<{
        source: string
        destination: string
        has?: Array<{ type: string; key: string; value?: string }>
      }>
      headers: Array<{
        source: string
        has?: Array<{ type: string; key: string; value?: string }>
        headers: Array<{ key: string; value: string }>
      }>
    }

    expect(config.proxy?.entrypoint).toBe("docs/proxy.ts")
    expect(
      config.rewrites.some((rule) =>
        rule.has?.some(({ key }) => key.toLowerCase() === "accept")
      )
    ).toBe(false)
    expect(
      config.headers.some((rule) =>
        rule.has?.some(({ key }) => key.toLowerCase() === "accept")
      )
    ).toBe(false)

    const vary = config.headers
      .find(({ source }) => source === "/:path*")
      ?.headers.find(({ key }) => key.toLowerCase() === "vary")
    expect(vary?.value).toContain("Accept")
    expect(vary?.value).toContain("Accept-Encoding")

    const markdownType = config.headers
      .find(({ source }) => source === "/:path*.md")
      ?.headers.find(({ key }) => key.toLowerCase() === "content-type")
    expect(markdownType?.value).toBe("text/markdown; charset=utf-8")
  })

  it("keeps the middleware off paths it cannot negotiate", () => {
    const proxy = readRepoFile("docs/proxy.ts")

    expect(proxy).toContain('runtime: "nodejs"')
    for (const excluded of [
      "_astro/",
      "assets/",
      "og/",
      "\\.well-known/",
      "reference/"
    ]) {
      expect(proxy, excluded).toContain(excluded)
    }
  })

  it("publishes an RFC 9727 API catalog naming both surfaces", () => {
    /*
     * Built rather than read: `docs/public` is generated and gitignored, so the
     * published artifact exists only after `docs:generate`. A test that read it
     * passed locally and failed on a clean checkout.
     */
    const catalog = apiCatalogDocument()

    expect(catalog.linkset).toHaveLength(2)
    for (const entry of catalog.linkset) {
      expect(entry.anchor).toMatch(/^https?:\/\//)
      expect(entry["service-desc"][0].href).toMatch(/^https:\/\//)
      expect(entry["service-doc"][0].href).toContain("/developers/")
      expect(entry.status[0].href).toBeTruthy()
    }

    const anchors = catalog.linkset.map((entry) => entry.anchor)
    expect(anchors).toContain("https://www.ollamaclient.in/api")
    expect(
      anchors.some((anchor) => anchor.startsWith("http://127.0.0.1"))
    ).toBe(true)
  })

  it("declares a deprecation policy an agent can read without prose", () => {
    const lifecycle = (
      openApi.info as unknown as {
        "x-api-lifecycle"?: {
          deprecationHeaders: string[]
          minimumNoticeDays: number
          policyUrl: string
        }
      }
    )["x-api-lifecycle"]

    expect(lifecycle?.deprecationHeaders).toEqual(["Deprecation", "Sunset"])
    expect(lifecycle?.minimumNoticeDays).toBeGreaterThanOrEqual(30)
    expect(lifecycle?.policyUrl).toContain(
      "/developers/#versioning-rate-limits-and-deprecation"
    )

    const portal = readRepoFile("docs/src/content/docs/developers.md")
    expect(portal).toContain("## Versioning, rate limits, and deprecation")
    expect(portal).toContain("### Deprecation and sunset policy")
    expect(portal).toContain("RFC 9745")
    expect(portal).toContain("RFC 8594")
  })

  it("lists developer resources by name in the agent map", () => {
    /*
     * The page list is empty because every assertion below is about the fixed
     * preamble, which is the part an agent navigates by. See the catalog test
     * for why this is built rather than read.
     */
    const llms = llmsTxtContent([])

    for (const entry of [
      "Ollama Client Developer Portal",
      "Ollama Client OpenAPI 3.1 Specification",
      "Ollama Client API Catalog",
      "Ollama Client Website JSON API",
      "olc CLI"
    ]) {
      expect(llms, entry).toContain(entry)
    }
    expect(llms).toContain("/.well-known/api-catalog")
    expect(llms).toContain("RateLimit-Remaining")
    expect(llms).toContain("Deprecation")
  })

  it("provides a custom 404 with stable recovery links", () => {
    const page = readRepoFile("docs/src/pages/404.astro")

    expect(page).toContain("HTTP 404")
    expect(page).toContain("/llms.txt")
    expect(page).toContain("/sitemap-index.xml")
    expect(page).toContain("/developers/")
  })
})
