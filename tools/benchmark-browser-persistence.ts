#!/usr/bin/env node

// Drives the dev-only benchmark.html page (src/entrypoints/benchmark/) in
// real browsers and collects the section 9.8 measurements as JSON.
//
// Chromium: loads the packaged benchmark build as a real unpacked MV3
// extension (same technique as verify-browser-automation-local.ts), so the
// numbers come from the actual chrome-extension:// origin.
// Firefox: Playwright cannot install extensions, so the Firefox MV2 benchmark
// build is served over local HTTP and measured at engine level. Quota and
// origin policy of a packaged moz-extension:// install are not covered.
//
// Usage:
//   pnpm benchmark:browser [--browser=chromium|firefox|all]
//     [--scales=small,medium,binary,tree] [--iterations=3] [--headful]
//
// Requires: pnpm benchmark:build (and benchmark:build:firefox for Firefox).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { chromium, firefox } from "playwright"
import type { Page } from "playwright"

const chromeBuildPath = resolve("build/chrome-mv3-benchmark")
const firefoxBuildPath = resolve("build/firefox-mv2-benchmark")
const artifactDir = resolve("artifacts/persistence-benchmark")
const scaleTimeoutMs = 15 * 60 * 1000

const VALID_SCALES = ["small", "medium", "large", "binary", "tree"]

interface CliOptions {
  browsers: ("chromium" | "firefox")[]
  scales: string[]
  iterations: number
  headful: boolean
  page: string
}

const parseArgs = (): CliOptions => {
  const argValue = (name: string): string | undefined =>
    process.argv
      .find((argument) => argument.startsWith(`--${name}=`))
      ?.split("=")[1]

  const browserArgument = argValue("browser") ?? "all"
  if (!["chromium", "firefox", "all"].includes(browserArgument)) {
    throw new Error("--browser must be chromium, firefox, or all")
  }
  const scales = (argValue("scales") ?? "small,medium,binary,tree").split(",")
  for (const scale of scales) {
    if (!VALID_SCALES.includes(scale)) {
      throw new Error(
        `Unknown scale "${scale}". Valid: ${VALID_SCALES.join(", ")}`
      )
    }
  }
  const iterations = Number(argValue("iterations") ?? 3)
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("--iterations must be a positive integer")
  }

  const page = argValue("page") ?? "benchmark.html"
  if (!["benchmark.html", "spike-opfs.html"].includes(page)) {
    throw new Error("--page must be benchmark.html or spike-opfs.html")
  }

  return {
    browsers:
      browserArgument === "all"
        ? ["chromium", "firefox"]
        : [browserArgument as "chromium" | "firefox"],
    scales,
    iterations,
    headful: process.argv.includes("--headful"),
    page
  }
}

const runScalesOnPage = async (
  page: Page,
  scales: string[],
  iterations: number,
  label: string
): Promise<unknown[]> => {
  const results: unknown[] = []
  for (const scale of scales) {
    console.error(`[${label}] running scale: ${scale}`)
    await page.selectOption("#scale", scale)
    await page.fill("#iterations", String(iterations))
    await page.click("#run")
    await page.waitForFunction(
      () => {
        const status = document.getElementById("status")?.textContent ?? ""
        return status === "Done" || status.startsWith("Failed")
      },
      undefined,
      { timeout: scaleTimeoutMs, polling: 500 }
    )
    const status = await page.textContent("#status")
    if (status !== "Done") {
      throw new Error(`[${label}] scale ${scale} failed: ${status}`)
    }
    const output = await page.textContent("#output")
    if (!output) throw new Error(`[${label}] scale ${scale} produced no output`)
    results.push(JSON.parse(output))
    console.error(`[${label}] scale ${scale} done`)
  }
  // Free benchmark IndexedDB space before the browser closes.
  await page.click("#cleanup")
  await page.waitForFunction(
    () => {
      const status = document.getElementById("status")?.textContent ?? ""
      return (
        status.startsWith("Benchmark databases deleted") ||
        status.startsWith("Cleanup blocked") ||
        status.startsWith("Cleanup failed")
      )
    },
    undefined,
    { timeout: 60_000 }
  )
  return results
}

const findFileRecursive = (dir: string, targetName: string): string => {
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isFile() && entry === targetName) return fullPath
    if (stats.isDirectory()) {
      const found = findFileRecursive(fullPath, targetName)
      if (found) return found
    }
  }
  return ""
}

const resolveChromiumExtensionId = async (
  context: import("playwright").BrowserContext,
  userDataDir: string
): Promise<string> => {
  let [serviceWorker] = context.serviceWorkers()
  if (!serviceWorker) {
    try {
      serviceWorker = await context.waitForEvent("serviceworker", {
        timeout: 10000
      })
    } catch {
      // fall through to profile inspection
    }
  }
  if (serviceWorker) return new URL(serviceWorker.url()).host

  // Unpacked-extension entries carry the load path, which is stable across
  // locales; match on it instead of the (possibly localized) name.
  await new Promise((resolvePause) => setTimeout(resolvePause, 1500))
  for (const fileName of ["Preferences", "Secure Preferences"]) {
    const preferencesPath = findFileRecursive(userDataDir, fileName)
    if (!preferencesPath) continue
    const preferences = JSON.parse(readFileSync(preferencesPath, "utf8")) as {
      extensions?: {
        settings?: Record<string, { path?: string }>
      }
    }
    for (const [id, value] of Object.entries(
      preferences?.extensions?.settings ?? {}
    )) {
      if (value?.path === chromeBuildPath) return id
    }
  }
  throw new Error("Failed to resolve Chromium extension id")
}

const runChromium = async (options: CliOptions): Promise<unknown[]> => {
  if (!existsSync(resolve(chromeBuildPath, options.page))) {
    throw new Error(
      `Missing ${chromeBuildPath}/${options.page} — run: pnpm benchmark:build`
    )
  }
  const userDataDir = mkdtempSync(`${tmpdir()}/ollama-client-benchmark-`)
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !options.headful,
    args: [
      `--disable-extensions-except=${chromeBuildPath}`,
      `--load-extension=${chromeBuildPath}`
    ]
  })
  try {
    const extensionId = await resolveChromiumExtensionId(context, userDataDir)
    console.error(`[chromium] extension id: ${extensionId}`)
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/${options.page}`)
    return await runScalesOnPage(
      page,
      options.scales,
      options.iterations,
      "chromium"
    )
  } finally {
    await context.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

const startStaticServer = async (
  rootDir: string
): Promise<{ origin: string; close: () => Promise<void> }> => {
  const mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".png": "image/png"
  }
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname
    const filePath = resolve(rootDir, `.${pathname}`)
    try {
      const file = readFileSync(filePath)
      const extension = filePath.slice(filePath.lastIndexOf("."))
      response.statusCode = 200
      response.setHeader(
        "Content-Type",
        mimeTypes[extension] || "application/octet-stream"
      )
      response.end(file)
    } catch {
      response.statusCode = 404
      response.end("Not Found")
    }
  })
  await new Promise<void>((resolveListen) => {
    server.listen({ port: 0, host: "127.0.0.1" }, () => resolveListen())
  })
  const address = server.address() as AddressInfo | null
  return {
    origin: `http://127.0.0.1:${address?.port ?? 0}`,
    close: () =>
      new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  }
}

const runFirefox = async (options: CliOptions): Promise<unknown[]> => {
  if (!existsSync(resolve(firefoxBuildPath, options.page))) {
    throw new Error(
      `Missing ${firefoxBuildPath}/${options.page} — run: pnpm benchmark:build:firefox`
    )
  }
  const server = await startStaticServer(firefoxBuildPath)
  const browser = await firefox.launch({ headless: !options.headful })
  try {
    const page = await browser.newPage()
    await page.goto(`${server.origin}/${options.page}`)
    return await runScalesOnPage(
      page,
      options.scales,
      options.iterations,
      "firefox"
    )
  } finally {
    await browser.close()
    await server.close()
  }
}

const main = async (): Promise<void> => {
  const options = parseArgs()
  const report: Record<string, unknown> = {
    measuredAt: new Date().toISOString(),
    iterations: options.iterations,
    scales: options.scales
  }

  for (const browser of options.browsers) {
    if (browser === "chromium") {
      let runs: unknown[]
      try {
        runs = await runChromium(options)
      } catch (error) {
        if (
          options.headful ||
          !String(error).includes("Failed to resolve Chromium extension id")
        ) {
          throw error
        }
        // Headless MV3 service workers can stay lazy; mirror the existing
        // browser-automation tool and retry once in visible mode.
        console.error("[chromium] headless bootstrap failed, retrying headful")
        runs = await runChromium({ ...options, headful: true })
      }
      report.chromium = {
        environment: "packaged MV3 extension loaded unpacked (real origin)",
        runs
      }
    } else {
      report.firefox = {
        environment:
          "MV2 benchmark bundle over local HTTP (engine-level; not a packaged moz-extension origin)",
        runs: await runFirefox(options)
      }
    }
  }

  mkdirSync(artifactDir, { recursive: true })
  const outputPath = resolve(
    artifactDir,
    `browser-benchmark-${Date.now()}.json`
  )
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  console.error(`Report written: ${outputPath}`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
