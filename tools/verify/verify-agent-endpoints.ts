#!/usr/bin/env tsx
/**
 * Probe a deployed docs site for the contract agent clients depend on.
 *
 * Every check here is something only a real deployment can answer: Vercel's
 * routing order, whether the Routing Middleware ran, and whether a CDN handed
 * back the wrong cached variant. The unit tests cover the decisions; this
 * covers the deployment that carries them out.
 *
 *   pnpm verify:agent-endpoints                       # production
 *   pnpm verify:agent-endpoints https://preview.host  # a preview deploy
 */
import { pathToFileURL } from "node:url"

import { DOC_ORDER } from "../../docs/src/seo/doc-ia.mjs"
import { LEGACY_REDIRECTS } from "../../docs/src/seo/legacy-redirects.mjs"

const DEFAULT_BASE = "https://www.ollamaclient.in"

type Check = {
  name: string
  ok: boolean
  detail: string
}

const results: Check[] = []

const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail })
}

const fetchPath = async (
  base: string,
  path: string,
  init: RequestInit = {}
) => {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    ...init
  })
  const body = await response.text()
  return { response, body }
}

const contentType = (response: Response) =>
  response.headers.get("content-type") ?? ""

const looksLikeHtml = (body: string) => /^\s*<(!doctype|html)/i.test(body)

const checkMarkdownVariant = async (
  base: string,
  path: string,
  expectedStatus = 200
) => {
  const { response, body } = await fetchPath(base, path, {
    headers: { Accept: "text/markdown" }
  })
  const vary = response.headers.get("vary") ?? ""
  const ok =
    response.status === expectedStatus &&
    contentType(response).includes("text/markdown") &&
    !looksLikeHtml(body) &&
    /accept/i.test(vary)

  record(
    `markdown negotiation ${path}`,
    ok,
    `${response.status} ${contentType(response)} vary=${vary || "none"} html=${looksLikeHtml(body)}`
  )
}

const checkHtmlVariant = async (base: string, path: string) => {
  const { response, body } = await fetchPath(base, path, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  })
  const ok =
    response.status === 200 &&
    contentType(response).includes("text/html") &&
    looksLikeHtml(body)

  record(
    `html variant ${path}`,
    ok,
    `${response.status} ${contentType(response)} html=${looksLikeHtml(body)}`
  )
}

const checkJson = async (
  base: string,
  path: string,
  expectedStatus: number,
  init: RequestInit = {}
) => {
  const { response, body } = await fetchPath(base, path, init)
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = undefined
  }

  const rateLimited = ["RateLimit-Limit", "RateLimit-Remaining"].every((key) =>
    response.headers.has(key)
  )
  const ok =
    response.status === expectedStatus &&
    contentType(response).includes("application/json") &&
    parsed !== undefined &&
    rateLimited

  record(
    `json ${init.method ?? "GET"} ${path}`,
    ok,
    `${response.status} ${contentType(response)} rateLimitHeaders=${rateLimited} parsed=${parsed !== undefined}`
  )
  return parsed
}

const checkStatus = async (
  base: string,
  path: string,
  expectedStatus: number,
  init: RequestInit = {}
) => {
  const { response } = await fetchPath(base, path, init)
  record(
    `status ${init.method ?? "GET"} ${path}`,
    response.status === expectedStatus,
    `${response.status} (expected ${expectedStatus})`
  )
}

const checkLegacyAlias = async (base: string, path: string, target: string) => {
  const { response } = await fetchPath(base, path, {
    headers: { Accept: "text/markdown" }
  })
  const location = response.headers.get("location") ?? ""
  const ok = response.status === 308 && location === target

  record(
    `legacy alias ${path}`,
    ok,
    `${response.status} -> ${location || "none"} (expected 308 -> ${target})`
  )
}

const checkMachineFile = async (
  base: string,
  path: string,
  expectedType: string,
  mustContain: string
) => {
  const { response, body } = await fetchPath(base, path)
  const ok =
    response.status === 200 &&
    contentType(response).includes(expectedType) &&
    body.includes(mustContain)

  record(
    `machine-readable ${path}`,
    ok,
    `${response.status} ${contentType(response)} contains=${body.includes(mustContain)}`
  )
}

export async function verifyAgentEndpoints(base: string) {
  await checkHtmlVariant(base, "/")
  await checkHtmlVariant(base, "/developers")
  await checkMarkdownVariant(base, "/")
  for (const slug of DOC_ORDER) {
    await checkMarkdownVariant(base, `/${slug}`)
  }

  /*
   * A 404 negotiated as Markdown is the recovery path: a real 404 status
   * carrying a Markdown body, not an HTML shell and not a 200.
   */
  await checkMarkdownVariant(base, "/some-path-that-does-not-exist", 404)
  /*
   * Old inbound URLs resolve in a browser through a meta-refresh page the
   * middleware never reaches. A Markdown client has to be sent somewhere real.
   */
  for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) {
    await checkLegacyAlias(base, from, to)
  }

  await checkStatus(base, "/some-path-that-does-not-exist", 404)
  await checkStatus(base, "/developers", 406, {
    headers: { Accept: "application/xml" }
  })

  await checkJson(base, "/api", 200)
  await checkJson(base, "/api/health", 200)
  await checkJson(base, "/api/does-not-exist", 404)
  /*
   * An extension on an unknown API path is what a path matcher mistakes for a
   * static asset. If this one comes back as HTML, the middleware is not seeing
   * the request.
   */
  await checkJson(base, "/api/models.json", 404)
  await checkJson(base, "/api", 405, { method: "POST" })

  await checkMachineFile(base, "/llms.txt", "text/markdown", "## Docs")
  await checkMachineFile(base, "/llms-full.txt", "text/markdown", "# Ollama")
  await checkMachineFile(base, "/ai.txt", "text/plain", "llms.txt")
  await checkMachineFile(base, "/index.md", "text/markdown", "# Ollama Client")
  await checkMachineFile(base, "/404.md", "text/markdown", "# 404")
  await checkMachineFile(base, "/openapi.json", "application/json", "openapi")
  await checkMachineFile(
    base,
    "/.well-known/api-catalog",
    "application/linkset+json",
    "linkset"
  )
  await checkMachineFile(base, "/robots.txt", "text/plain", "Sitemap:")
  await checkMachineFile(base, "/sitemap-index.xml", "xml", "sitemap")

  return results
}

async function main() {
  const base = (process.argv[2] ?? DEFAULT_BASE).replace(/\/+$/, "")
  console.log(`Verifying agent endpoints on ${base}\n`)

  const checks = await verifyAgentEndpoints(base)
  for (const check of checks) {
    console.log(
      `${check.ok ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`
    )
  }

  const failed = checks.filter((check) => !check.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
  if (failed.length > 0) process.exitCode = 1
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main()
}
