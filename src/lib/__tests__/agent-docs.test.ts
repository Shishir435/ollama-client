import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { OLC_PUBLIC_ROUTES } from "../../../packages/olc/src/core/public-api-contract"
import { buildOlcOpenApi } from "../../../tools/generate/generate-openapi"

const REPO_ROOT = join(__dirname, "../../..")
const readRepoFile = (path: string) =>
  readFileSync(join(REPO_ROOT, path), "utf-8")

const openApi = buildOlcOpenApi() as {
  openapi: string
  info: { title: string; version: string; description: string }
  servers: Array<{ url: string }>
  paths: Record<
    string,
    Record<
      string,
      {
        operationId?: string
        description?: string
        parameters?: Array<{ schema?: unknown }>
        responses?: Record<string, unknown>
      }
    >
  >
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
        .every((parameter) => Boolean(parameter.schema))
    ).toBe(true)
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

  it("configures Markdown negotiation without hiding response variants", () => {
    const config = JSON.parse(readRepoFile("vercel.json")) as {
      rewrites: Array<{
        source: string
        destination: string
        has?: Array<{ type: string; key: string; value?: string }>
      }>
      headers: Array<{
        source: string
        headers: Array<{ key: string; value: string }>
      }>
    }
    const markdownRewrite = config.rewrites.find(
      ({ source, destination }) =>
        source === "/:path((?!reference(?:/|$))(?!.*\\.).*)" &&
        destination === "/:path*.md"
    )
    const vary = config.headers
      .flatMap(({ headers }) => headers)
      .find(({ key }) => key.toLowerCase() === "vary")

    expect(markdownRewrite?.has).toContainEqual({
      type: "header",
      key: "Accept",
      value: ".*text/markdown.*"
    })
    const routePattern = markdownRewrite?.source.match(/^\/:path\((.*)\)$/)?.[1]
    expect(routePattern).toBeDefined()
    const negotiatedPath = new RegExp(`^${routePattern}$`)
    expect(negotiatedPath.test("developers")).toBe(true)
    expect(negotiatedPath.test("guides/provider-setup")).toBe(true)
    expect(negotiatedPath.test("reference")).toBe(false)
    expect(negotiatedPath.test("reference/lib/providers")).toBe(false)
    expect(negotiatedPath.test("openapi.json")).toBe(false)
    expect(vary?.value).toContain("Accept")
    expect(vary?.value).toContain("Accept-Encoding")
  })

  it("provides a custom 404 with stable recovery links", () => {
    const page = readRepoFile("docs/src/pages/404.astro")

    expect(page).toContain("HTTP 404")
    expect(page).toContain("/llms.txt")
    expect(page).toContain("/sitemap-index.xml")
    expect(page).toContain("/developers/")
  })
})
