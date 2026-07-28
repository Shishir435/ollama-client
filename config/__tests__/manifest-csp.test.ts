import { describe, expect, it } from "vitest"

import config from "../../wxt.config"

/*
 * The extension_pages CSP is the one manifest field where a dev-only relaxation
 * would be invisible in review and shipped to the store. It gained one: the Vite
 * dev server serves every module, so `new Worker(new URL("./chat-db-worker.ts",
 * import.meta.url))` resolves to the dev origin, and `worker-src 'self'` refused
 * it — durable chat history could never migrate under `pnpm dev`. Allowing that
 * origin is correct for serve and wrong for anything packaged, so both halves are
 * asserted here.
 */

type ManifestFn = (env: {
  browser: string
  command: string
  manifestVersion: number
  mode: string
}) => { content_security_policy?: { extension_pages?: string } }

const cspFor = (command: string, browser = "chrome"): string => {
  const manifest = config.manifest as unknown as ManifestFn
  const csp = manifest({
    browser,
    command,
    manifestVersion: 3,
    mode: command === "serve" ? "development" : "production"
  }).content_security_policy?.extension_pages
  if (!csp) throw new Error("extension_pages CSP missing from the manifest")
  return csp
}

const directive = (csp: string, name: string): string => {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `))
  if (!found) throw new Error(`${name} missing from CSP: ${csp}`)
  return found
}

describe("extension_pages CSP", () => {
  it("keeps worker-src to 'self' in any packaged build", () => {
    for (const command of ["build", "zip"]) {
      expect(directive(cspFor(command), "worker-src")).toBe("worker-src 'self'")
    }
  })

  it("names no dev origin anywhere in a packaged build", () => {
    const csp = cspFor("build")
    expect(csp).not.toContain("localhost")
    expect(csp).not.toContain("127.0.0.1")
  })

  it("lets the dev server host the chat-db worker while serving", () => {
    const workerSrc = directive(cspFor("serve"), "worker-src")
    expect(workerSrc).toContain("'self'")
    // Port-agnostic: a non-default dev port must keep working.
    expect(workerSrc).toContain("http://localhost:*")
    expect(workerSrc).toContain("http://127.0.0.1:*")
  })

  it("does not loosen any other directive for dev", () => {
    const dev = cspFor("serve")
    const prod = cspFor("build")
    for (const name of ["script-src", "connect-src", "object-src"]) {
      expect(directive(dev, name)).toBe(directive(prod, name))
    }
  })

  it("applies the same policy to the Firefox target", () => {
    expect(directive(cspFor("build", "firefox"), "worker-src")).toBe(
      "worker-src 'self'"
    )
    expect(directive(cspFor("serve", "firefox"), "worker-src")).toContain(
      "http://localhost:*"
    )
  })
})
