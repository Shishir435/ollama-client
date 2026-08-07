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
//   3. Real migration: seed a legacy blob (section 9.8 fixture),
//      clear the backend marker, reload the extension; the owner migrates
//      the blob, verifies every durable table, records a receipt, flips the
//      marker — and the blob stays untouched as the rollback artifact.
//   4. Host loss during migration: the browser (and with it the offscreen
//      owner) is torn down while the migration is in flight. The next boot
//      must complete it with exact per-table counts and a sound database.
//   5. Operator override: with the device-local switch set, the profile serves
//      chat history from the retained blob again and the migration stays
//      skipped; clearing it migrates on the next boot.
//   6. A restore whose payload is not a usable database is rejected with the
//      existing chat history still in place.
//   7. Backup export comes from the OPFS owner and is a valid SQLite file.
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

interface TableCounts {
  sessions: number
  messages: number
  tables: Record<string, number>
}

interface MigrationReceipt {
  outcome?: string
  attempts?: number
  sourceSchemaVersion?: number
  sourceCounts?: Record<string, number>
  importedCounts?: Record<string, number>
  importedIntegrity?: { integrityCheck?: string; foreignKeyViolations?: number }
  failure?: string
}

/** Every table the source blob populated must arrive with the same count. */
const tableCountsMatch = (
  seeded: Record<string, number>,
  migrated: Record<string, number>
): boolean =>
  Object.entries(seeded).every(
    ([table, count]) => count === 0 || migrated[table] === count
  )

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
    const freshCounts = (await call("counts")) as TableCounts
    const freshReceipt = (await call("migrationReceipt")) as MigrationReceipt
    // Historically a fresh profile could still end up with a legacy blob:
    // whichever context read the marker first saw "legacy" and stamped an empty
    // database of its own before the owner migrated. Clients hold no engine
    // since 0.13.x, so only the owner can create one and only after it has
    // chosen a backend. The receipt should now always be "fresh"; the
    // "migrated with nothing in it" branch is kept because a profile carried
    // over from an older build can still present that way.
    record(
      "fresh-profile-opfs-init",
      freshCounts.sessions === 0 &&
        freshCounts.messages === 0 &&
        (freshReceipt?.outcome === "fresh" ||
          (freshReceipt?.outcome === "migrated" &&
            freshReceipt.sourceCounts?.sessions === 0)),
      { freshMarker, freshCounts, freshReceipt }
    )

    // ---- 2. Concurrent facade writes from two pages, exact counts ----
    const second = await openVerifyPage(context, extensionId)
    const APPENDS = 30
    await Promise.all([
      call("appendViaFacade", "verify-a", APPENDS),
      second.call("appendViaFacade", "verify-b", APPENDS)
    ])
    const afterWrites = (await call("counts")) as TableCounts
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
      tables: Record<string, number>
    }
    const sourceDigest = (await call("readLegacyBlobDigest")) as string
    await call("clearMarker")
    await call("clearMigrationReceipt")
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
    const migratedCounts = (await call("counts")) as TableCounts
    const migratedReceipt = (await call(
      "migrationReceipt"
    )) as MigrationReceipt
    const migratedIntegrity = (await call("integrityInfo")) as {
      integrityCheck: string
      foreignKeyViolations: number
    }
    const blobAfter = (await call("readLegacyBlobLength")) as number
    const digestAfter = (await call("readLegacyBlobDigest")) as string
    record(
      "legacy-blob-migration-verified",
      migratedCounts.sessions === FIXTURE_SESSIONS &&
        migratedCounts.messages === FIXTURE_MESSAGES &&
        migratedMarker.sourceCounts?.sessions === FIXTURE_SESSIONS,
      { seeded, migratedMarker, migratedCounts }
    )
    record(
      "every-durable-table-migrated",
      tableCountsMatch(seeded.tables, migratedCounts.tables),
      { seeded: seeded.tables, migrated: migratedCounts.tables }
    )
    record(
      "migrated-database-is-sound",
      migratedIntegrity.integrityCheck === "ok" &&
        migratedIntegrity.foreignKeyViolations === 0,
      migratedIntegrity
    )
    record(
      "migration-receipt-recorded",
      migratedReceipt?.outcome === "migrated" &&
        typeof migratedReceipt.sourceSchemaVersion === "number" &&
        migratedReceipt.sourceCounts?.sessions === FIXTURE_SESSIONS &&
        migratedReceipt.importedIntegrity?.integrityCheck === "ok",
      migratedReceipt
    )
    record(
      "rollback-blob-untouched",
      blobAfter === seeded.blobBytes && digestAfter === sourceDigest,
      {
        blobAfter,
        seededBytes: seeded.blobBytes,
        digestAfter,
        sourceDigest
      }
    )

    // ---- 4. The owner is destroyed mid-migration; the next boot finishes ----
    // Tearing down the browser takes the offscreen host with it, which is the
    // eviction case that matters: the migration is interrupted after the
    // physical import has begun and before the marker flips.
    const bigSeed = (await call(
      "seedLegacyBlob",
      FIXTURE_SESSIONS * 4,
      FIXTURE_MESSAGES * 6
    )) as { sessions: number; messages: number; tables: Record<string, number> }
    await call("clearMarker")
    await call("clearMigrationReceipt")
    await page.close().catch(() => {})
    await context.close()

    // Boot far enough to start the migration, then kill the host. No page is
    // opened: the background creates the owner eagerly at startup.
    context = await launch()
    await new Promise((resolvePause) => setTimeout(resolvePause, 400))
    await context.close()

    context = await launch()
    await new Promise((resolvePause) => setTimeout(resolvePause, 1500))
    ;({ page, call } = await openVerifyPage(context, extensionId))
    await waitForOpfsMarker(call, 45000)
    const resumedCounts = (await call("counts")) as TableCounts
    const resumedIntegrity = (await call("integrityInfo")) as {
      integrityCheck: string
      foreignKeyViolations: number
    }
    const resumedReceipt = (await call("migrationReceipt")) as MigrationReceipt
    record(
      "interrupted-migration-resumes-exactly",
      resumedCounts.sessions === bigSeed.sessions &&
        resumedCounts.messages === bigSeed.messages &&
        tableCountsMatch(bigSeed.tables, resumedCounts.tables) &&
        resumedIntegrity.integrityCheck === "ok" &&
        resumedReceipt?.outcome === "migrated",
      { bigSeed, resumedCounts, resumedIntegrity, resumedReceipt }
    )

    // ---- 5. Operator override returns the profile to the retained blob ----
    await call("setLegacyOverride", true)
    const overriddenBackend = (await call("activeBackend")) as string
    const overriddenCounts = (await call("counts")) as TableCounts
    record(
      "override-serves-legacy-blob",
      overriddenBackend === "legacy" &&
        overriddenCounts.sessions === bigSeed.sessions,
      { overriddenBackend, overriddenCounts }
    )

    await call("clearMarker")
    await call("clearMigrationReceipt")
    await page.close().catch(() => {})
    await context.close()
    context = await launch()
    await new Promise((resolvePause) => setTimeout(resolvePause, 2500))
    ;({ page, call } = await openVerifyPage(context, extensionId))
    const skippedBackend = (await call("activeBackend")) as string
    const skippedReceipt = (await call("migrationReceipt")) as MigrationReceipt
    record(
      "override-skips-migration-on-boot",
      skippedBackend === "legacy" && skippedReceipt?.outcome === "skipped",
      { skippedBackend, skippedReceipt }
    )

    await call("setLegacyOverride", false)
    await page.close().catch(() => {})
    await context.close()
    context = await launch()
    await new Promise((resolvePause) => setTimeout(resolvePause, 1500))
    ;({ page, call } = await openVerifyPage(context, extensionId))
    await waitForOpfsMarker(call, 45000)
    const restoredCounts = (await call("counts")) as TableCounts
    record(
      "cleared-override-migrates-again",
      ((await call("activeBackend")) as string) === "opfs" &&
        restoredCounts.messages === bigSeed.messages,
      { restoredCounts }
    )

    // ---- 6. A rejected restore leaves the live database intact ----
    const beforeRestore = (await call("counts")) as TableCounts
    const rejected = (await call("importCorruptBackup")) as { error: string }
    const afterRestore = (await call("counts")) as TableCounts
    record(
      "rejected-restore-preserves-database",
      rejected.error.length > 0 &&
        afterRestore.messages === beforeRestore.messages &&
        afterRestore.sessions === beforeRestore.sessions,
      { rejected, beforeRestore, afterRestore }
    )

    // ---- 7. Backup export served by the OPFS owner ----
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
