#!/usr/bin/env node

/**
 * Firefox counterpart to the Chromium `@critical` origin test in
 * e2e/chromium/critical/__tests__/provider-streaming.spec.ts, in real,
 * packaged Firefox.
 *
 * Firefox has no DNR, so `firefox-origin-guard.ts` removes `Origin` with a
 * blocking webRequest listener. Playwright's Firefox cannot install an
 * add-on, so this drives a stock Firefox through geckodriver, the same way
 * verify-firefox-opfs-migration.ts does.
 *
 * A fake Ollama refuses any `Origin` outside Ollama's default allow list with
 * 403, like `ollama serve` without `OLLAMA_ORIGINS`. Checks:
 *   1. An extension page's POST to the configured provider arrives without
 *      `Origin` (and is retried until the reconcile after saving has run).
 *   2. Model listing through the RPC boundary succeeds.
 *   3. A durable chat turn, sent by the background page, completes.
 *   4. Control: the same extension page's POST to an unconfigured origin
 *      still carries `moz-extension://…` and is refused — the guard is scoped
 *      to configured providers, and Firefox does send the header.
 *   5. A web page's POST to the provider keeps its own `Origin`.
 *
 * Usage: pnpm verify:firefox-origin-guard [--headful]
 * Requires: pnpm benchmark:build:firefox (the verify page is dev-gated) and a
 * local Firefox install (override the binary with FIREFOX_BIN, and
 * geckodriver with GECKODRIVER_BIN — e.g. inside a Linux container).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import { Builder, type WebDriver } from "selenium-webdriver"
import firefox from "selenium-webdriver/firefox.js"

const buildPath = resolve("build/firefox-mv2-benchmark")
const artifactDir = resolve("artifacts/origin-guard")
const geckodriverBin =
  process.env.GECKODRIVER_BIN ?? resolve("node_modules/.bin/geckodriver")
const firefoxBin =
  process.env.FIREFOX_BIN ?? "/Applications/Firefox.app/Contents/MacOS/firefox"
const headful = process.argv.includes("--headful")

/** Must match browser_specific_settings.gecko.id in the built manifest. */
const GECKO_ID = "shishirchaurasiya435@gmail.com"
const UUID = "6c1c1f9e-2f5f-4c9a-9c11-0000000a11ce"
const EXTENSION_ORIGIN = `moz-extension://${UUID}`
const VERIFY_URL = `${EXTENSION_ORIGIN}/persistence-verify.html`

const OLLAMA_DEFAULT_ALLOWED_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/

interface SeenRequest {
  server: string
  method: string
  path: string
  origin: string | undefined
  status: number
}

interface CheckResult {
  name: string
  pass: boolean
  detail: unknown
}

const results: CheckResult[] = []
const record = (name: string, pass: boolean, detail: unknown): void => {
  results.push({ name, pass, detail })
  console.error(`${pass ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail))
}

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms))

const sendJson = (response: ServerResponse, payload: unknown): void => {
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify(payload))
}

const fakeOllama =
  (name: string, seen: SeenRequest[]) =>
  (request: IncomingMessage, response: ServerResponse): void => {
    request.resume()
    request.on("end", () => {
      const origin = request.headers.origin
      const path = request.url ?? ""
      const allowed = !origin || OLLAMA_DEFAULT_ALLOWED_ORIGIN.test(origin)
      seen.push({
        server: name,
        method: request.method ?? "",
        path,
        origin,
        status: allowed ? 200 : 403
      })
      if (!allowed) {
        response.statusCode = 403
        response.end()
        return
      }
      if (path.endsWith("/api/tags")) {
        sendJson(response, {
          models: [
            {
              name: "catalog-model",
              model: "catalog-model",
              modified_at: new Date(0).toISOString(),
              size: 1,
              digest: "catalog",
              details: { format: "safetensors" }
            }
          ]
        })
        return
      }
      if (path.endsWith("/api/show")) {
        sendJson(response, {
          capabilities: ["completion"],
          details: { family: "verify", parameter_size: "1B" }
        })
        return
      }
      if (path.endsWith("/api/chat")) {
        response.setHeader("Content-Type", "application/x-ndjson")
        response.end(
          `${JSON.stringify({ message: { content: "pong" }, done: false })}\n${JSON.stringify({ message: { content: "" }, done: true })}\n`
        )
        return
      }
      response.statusCode = 404
      sendJson(response, { error: "not found" })
    })
  }

const listen = async (
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{ origin: string; close: () => void }> => {
  const server = createServer(handler)
  await new Promise<void>((done, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", done)
  })
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => {
      server.close()
      server.closeAllConnections()
    }
  }
}

const launch = async (): Promise<WebDriver> => {
  const options = new firefox.Options()
  options.setBinary(firefoxBin)
  if (!headful) options.addArguments("-headless")
  options.setPreference(
    "extensions.webextensions.uuids",
    JSON.stringify({ [GECKO_ID]: UUID })
  )
  options.setPreference("xpinstall.signatures.required", false)
  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(
      new firefox.ServiceBuilder(geckodriverBin).addArguments(
        "--allow-system-access"
      )
    )
    .build()
  await (
    driver as unknown as {
      installAddon: (path: string, temporary: boolean) => Promise<string>
    }
  ).installAddon(buildPath, true)
  return driver
}

/**
 * Firefox refuses WebDriver navigation to moz-extension://, so the verify
 * page is opened from the chrome context with a system principal.
 */
const openVerifyTab = async (driver: WebDriver): Promise<void> => {
  const context = driver as unknown as {
    setContext: (c: unknown) => Promise<void>
  }
  const deadline = Date.now() + 30_000
  for (;;) {
    const before = new Set(await driver.getAllWindowHandles())
    try {
      await context.setContext(firefox.Context.CHROME)
      await driver.executeScript(
        `
        const win = Services.wm.getMostRecentWindow("navigator:browser");
        win.gBrowser.selectedTab = win.gBrowser.addTab(arguments[0], {
          triggeringPrincipal:
            Services.scriptSecurityManager.getSystemPrincipal()
        });
        `,
        VERIFY_URL
      )
      await context.setContext(firefox.Context.CONTENT)
      let opened: string | undefined
      for (let i = 0; i < 50 && !opened; i += 1) {
        opened = (await driver.getAllWindowHandles()).find(
          (handle) => !before.has(handle)
        )
        if (!opened) await sleep(200)
      }
      if (opened) {
        await driver.switchTo().window(opened)
        for (let i = 0; i < 60; i += 1) {
          const ready = await driver
            .executeScript<boolean>(
              "return document.getElementById('status')?.textContent === 'hooks-ready'"
            )
            .catch(() => false)
          if (ready) return
          await sleep(250)
        }
      }
    } catch {
      await context.setContext(firefox.Context.CONTENT).catch(() => {})
    }
    if (Date.now() > deadline) throw new Error("Verify page never got ready")
    await sleep(500)
  }
}

const call = async <T>(
  driver: WebDriver,
  method: string,
  ...args: unknown[]
): Promise<T> => {
  const outcome = await driver.executeAsyncScript<
    { ok: true; result: T } | { ok: false; error: string }
  >(
    (method: string, args: unknown[], done: (r: unknown) => void) => {
      const api = (
        window as unknown as {
          __persistenceVerify: Record<
            string,
            (...a: unknown[]) => Promise<unknown>
          >
        }
      ).__persistenceVerify
      Promise.resolve(api[method](...args))
        .then((result) => done({ ok: true, result }))
        .catch((error) => done({ ok: false, error: String(error) }))
    },
    method,
    args
  )
  if (!outcome.ok) throw new Error(`${method} failed: ${outcome.error}`)
  return outcome.result
}

/** POST from the active tab and report the status, or the network error. */
const postFrom = (
  driver: WebDriver,
  url: string,
  mode: RequestMode
): Promise<number | string> =>
  driver.executeAsyncScript<number | string>(
    (url: string, mode: RequestMode, done: (r: unknown) => void) => {
      fetch(url, {
        method: "POST",
        mode,
        headers: { "Content-Type": "text/plain" },
        body: "{}"
      })
        .then((response) => done(response.status))
        .catch((error) => done(String(error)))
    },
    url,
    mode
  )

const main = async (): Promise<void> => {
  if (!existsSync(buildPath)) {
    throw new Error(`${buildPath} is missing; run pnpm benchmark:build:firefox`)
  }
  const seen: SeenRequest[] = []
  const ollama = await listen(fakeOllama("configured", seen))
  const unconfigured = await listen(fakeOllama("unconfigured", seen))
  const site = await listen((_request, response) => {
    response.setHeader("Content-Type", "text/html")
    response.end("<!doctype html><title>site</title>")
  })

  const driver = await launch()
  try {
    await openVerifyTab(driver)
    await call(driver, "configureFakeProvider", "ollama", ollama.origin)

    /** 1. The extension page's own POST, retried until the reconcile ran. */
    let status: number | string = "not sent"
    for (let attempt = 0; attempt < 30 && status !== 200; attempt += 1) {
      status = await postFrom(driver, `${ollama.origin}/api/chat`, "cors")
      if (status !== 200) await sleep(500)
    }
    const pagePosts = seen.filter(
      (entry) => entry.server === "configured" && entry.method === "POST"
    )
    record(
      "extension page POST reaches the provider without Origin",
      status === 200 && pagePosts.at(-1)?.origin === undefined,
      {
        status,
        attempts: pagePosts.length,
        lastOrigin: pagePosts.at(-1)?.origin ?? null
      }
    )

    /** 2. Model listing through the background's RPC boundary. */
    const listing = await call<{ models: string[]; failures: string[] }>(
      driver,
      "listProviderModels",
      "ollama"
    )
    record(
      "model listing succeeds",
      listing.failures.length === 0 && listing.models.includes("catalog-model"),
      listing
    )

    /** 3. A durable turn, sent by the background page. */
    const before = seen.length
    const assistantId = await call<number>(
      driver,
      "startDurableTurn",
      "origin-guard-firefox",
      "origin guard ping",
      "ollama"
    )
    let turn: { status?: string; content?: string } = {}
    for (let i = 0; i < 60 && turn.status !== "completed"; i += 1) {
      turn = await call(
        driver,
        "durableTurnResult",
        "origin-guard-firefox",
        assistantId
      )
      if (turn.status === "failed") break
      await sleep(500)
    }
    const turnRequests = seen.slice(before)
    record(
      "chat turn completes and every request it sent lacked Origin",
      turn.status === "completed" &&
        turn.content === "pong" &&
        turnRequests.some((entry) => entry.path.endsWith("/api/chat")) &&
        turnRequests.every(
          (entry) => entry.origin === undefined && entry.status === 200
        ),
      { turn, requests: turnRequests }
    )

    /** 4. Control: an origin nobody configured keeps the header. */
    const controlStatus = await postFrom(
      driver,
      `${unconfigured.origin}/api/chat`,
      "cors"
    )
    const control = seen.filter((entry) => entry.server === "unconfigured")
    record(
      "an unconfigured origin keeps the extension's Origin and is refused",
      control.at(-1)?.origin === EXTENSION_ORIGIN &&
        control.at(-1)?.status === 403,
      { controlStatus, seen: control }
    )

    /** 5. A web page keeps its own Origin. */
    await driver.get(`${site.origin}/`)
    const siteStatus = await postFrom(
      driver,
      `${ollama.origin}/api/chat`,
      "no-cors"
    )
    await sleep(300)
    const fromSite = seen.filter((entry) => entry.origin === site.origin)
    record(
      "a web page's request keeps its own Origin",
      fromSite.length === 1 && fromSite[0].path === "/api/chat",
      { siteStatus, fromSite }
    )

    const foreign = seen.filter(
      (entry) =>
        entry.server === "configured" &&
        entry.origin !== undefined &&
        entry.origin !== site.origin
    )
    record(
      "the configured provider never saw an extension Origin after the reconcile",
      foreign.every((entry) => pagePosts.includes(entry)),
      { foreign }
    )
  } finally {
    await driver.quit().catch(() => {})
    ollama.close()
    unconfigured.close()
    site.close()
  }

  mkdirSync(artifactDir, { recursive: true })
  writeFileSync(
    resolve(artifactDir, "firefox-origin-guard.json"),
    `${JSON.stringify({ results }, null, 2)}\n`
  )
  const failed = results.filter((result) => !result.pass)
  console.error(
    `${results.length - failed.length}/${results.length} checks passed`
  )
  if (failed.length > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
