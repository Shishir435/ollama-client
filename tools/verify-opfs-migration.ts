#!/usr/bin/env node

// End-to-end verification of the production OPFS persistence backend in
// packaged Chromium. Drives the dev-only persistence-verify.html page, whose
// hooks call the REAL repository facade → backend dispatcher → persistence
// RPC → offscreen owner worker.
//
// Scenarios:
//   1. Fresh profile: the owner boots, finds no legacy blob, initializes the
//      OPFS backend and flips the marker.
//   2. Production writes: two pages append through the facade concurrently;
//      counts are exact (single-owner, no lost update).
//   3. Real migration: seed a legacy sql.js blob (section 9.8 fixture),
//      clear the backend marker, reload the extension; the owner migrates
//      the blob, verifies row counts, flips the marker — and the blob stays
//      untouched as the rollback artifact.
//   4. Backup export comes from the OPFS owner and is a valid SQLite file.
//
// Usage: pnpm verify:opfs-migration [--headful]
// Requires: pnpm benchmark:build (the verify page is dev-gated).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { chromium } from "playwright"
import type { BrowserContext, Page } from "playwright"

const buildPath = resolve("build/chrome-mv3-benchmark")
const artifactDir = resolve("artifacts/persistence-benchmark")
const headful = process.argv.includes("--headful")

const FIXTURE_SESSIONS = 40
const FIXTURE_MESSAGES = 800

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

const resolveExtensionId = async (
  context: BrowserContext,
  userDataDir: string
): Promise<string> => {
  let [serviceWorker] = context.serviceWorkers()
  if (!serviceWorker) {
    try {
      serviceWorker = await context.waitForEvent("serviceworker", {
        timeout: 10000
      })
    } catch {
      // fall through
    }
  }
  if (serviceWorker) return new URL(serviceWorker.url()).host

  await new Promise((resolvePause) => setTimeout(resolvePause, 1500))
  for (const fileName of ["Preferences", "Secure Preferences"]) {
    const preferencesPath = findFileRecursive(userDataDir, fileName)
    if (!preferencesPath) continue
    const preferences = JSON.parse(readFileSync(preferencesPath, "utf8")) as {
      extensions?: { settings?: Record<string, { path?: string }> }
    }
    for (const [id, value] of Object.entries(
      preferences?.extensions?.settings ?? {}
    )) {
      if (value?.path === buildPath) return id
    }
  }
  throw new Error("Failed to resolve Chromium extension id")
}

type VerifyCall = (method: string, ...args: unknown[]) => Promise<unknown>

const pageCall =
  (page: Page): VerifyCall =>
  (method, ...args) =>
    page.evaluate(
      ([methodName, callArgs]) => {
        const api = (
          window as unknown as {
            __persistenceVerify: Record<
              string,
              (...a: unknown[]) => Promise<unknown>
            >
          }
        ).__persistenceVerify
        return api[methodName as string](...(callArgs as unknown[]))
      },
      [method, args] as const
    )

const openVerifyPage = async (
  context: BrowserContext,
  extensionId: string
): Promise<{ page: Page; call: VerifyCall }> => {
  // Retried: the extension may be mid-restart after runtime.reload().
  const deadline = Date.now() + 30000
  for (;;) {
    const page = await context.newPage()
    try {
      await page.goto(
        `chrome-extension://${extensionId}/persistence-verify.html`,
        { timeout: 10000 }
      )
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent === "hooks-ready",
        undefined,
        { timeout: 10000 }
      )
      return { page, call: pageCall(page) }
    } catch (error) {
      await page.close().catch(() => {})
      if (Date.now() > deadline) throw error
      await new Promise((resolvePause) => setTimeout(resolvePause, 1000))
    }
  }
}

const waitForOpfsMarker = async (
  call: VerifyCall,
  timeoutMs: number
): Promise<unknown> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const marker = (await call("backendMarker")) as {
      backend?: string
    } | null
    if (marker?.backend === "opfs") return marker
    if (Date.now() > deadline) {
      throw new Error(`Backend marker never became opfs: ${JSON.stringify(marker)}`)
    }
    await new Promise((resolvePause) => setTimeout(resolvePause, 500))
  }
}

const runScenarios = async (visible: boolean): Promise<void> => {
  if (!existsSync(resolve(buildPath, "persistence-verify.html"))) {
    throw new Error(
      `Missing ${buildPath}/persistence-verify.html — run: pnpm benchmark:build`
    )
  }

  const userDataDir = mkdtempSync(`${tmpdir()}/ollama-client-opfs-migration-`)
  const launch = () =>
    chromium.launchPersistentContext(userDataDir, {
      headless: !visible,
      args: [
        `--disable-extensions-except=${buildPath}`,
        `--load-extension=${buildPath}`
      ]
    })
  let context = await launch()

  try {
    const extensionId = await resolveExtensionId(context, userDataDir)
    console.error(`[opfs-migration] extension id: ${extensionId}`)

    // ---- 1. Fresh profile boots straight onto the OPFS backend ----
    let { page, call } = await openVerifyPage(context, extensionId)
    const freshMarker = await waitForOpfsMarker(call, 20000)
    const freshCounts = (await call("counts")) as {
      sessions: number
      messages: number
    }
    record(
      "fresh-profile-opfs-init",
      freshCounts.sessions === 0 && freshCounts.messages === 0,
      { freshMarker, freshCounts }
    )

    // ---- 2. Concurrent facade writes from two pages, exact counts ----
    const second = await openVerifyPage(context, extensionId)
    const APPENDS = 30
    await Promise.all([
      call("appendViaFacade", "verify-a", APPENDS),
      second.call("appendViaFacade", "verify-b", APPENDS)
    ])
    const afterWrites = (await call("counts")) as {
      sessions: number
      messages: number
    }
    record(
      "concurrent-facade-writes",
      afterWrites.sessions === 2 && afterWrites.messages === APPENDS * 2,
      { expected: APPENDS * 2, ...afterWrites }
    )
    await second.page.close()

    // ---- 3. Real legacy-blob migration across an extension reload ----
    const seeded = (await call("seedLegacyBlob", FIXTURE_SESSIONS, FIXTURE_MESSAGES)) as {
      sessions: number
      messages: number
      blobBytes: number
    }
    await call("clearMarker")
    // Restart the whole browser with the same profile — runtime.reload() on
    // an unpacked extension leaves it blocked under Playwright, and a real
    // browser restart is the stronger claim anyway: the migration must run
    // on a cold boot.
    await page.close().catch(() => {})
    await context.close()
    context = await launch()
    await new Promise((resolvePause) => setTimeout(resolvePause, 1500))
    ;({ page, call } = await openVerifyPage(context, extensionId))

    const migratedMarker = (await waitForOpfsMarker(call, 30000)) as {
      sourceCounts?: { sessions: number; messages: number }
    }
    const migratedCounts = (await call("counts")) as {
      sessions: number
      messages: number
    }
    const blobAfter = (await call("readLegacyBlobLength")) as number
    record(
      "legacy-blob-migration-verified",
      migratedCounts.sessions === FIXTURE_SESSIONS &&
        migratedCounts.messages === FIXTURE_MESSAGES &&
        migratedMarker.sourceCounts?.sessions === FIXTURE_SESSIONS,
      { seeded, migratedMarker, migratedCounts }
    )
    record(
      "rollback-blob-untouched",
      blobAfter === seeded.blobBytes,
      { blobAfter, seededBytes: seeded.blobBytes }
    )

    // ---- 4. Backup export served by the OPFS owner ----
    const exportInfo = (await call("exportInfo")) as {
      byteLength: number
      magic: string
    }
    record(
      "export-from-opfs-owner",
      exportInfo.byteLength > 0 && exportInfo.magic === "SQLite format 3",
      exportInfo
    )

    await page.close()
  } finally {
    await context.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

const main = async (): Promise<void> => {
  try {
    await runScenarios(headful)
  } catch (error) {
    if (
      headful ||
      !String(error).includes("Failed to resolve Chromium extension id")
    ) {
      throw error
    }
    console.error("[opfs-migration] headless bootstrap failed, retrying headful")
    results.length = 0
    await runScenarios(true)
  }

  const report = {
    measuredAt: new Date().toISOString(),
    topology:
      "production OPFS single-owner backend; packaged Chromium; real repository facade",
    results
  }
  mkdirSync(artifactDir, { recursive: true })
  const outputPath = resolve(artifactDir, `opfs-migration-${Date.now()}.json`)
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  console.error(`Report written: ${outputPath}`)
  console.log(JSON.stringify(report, null, 2))

  if (results.some((result) => !result.pass)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
