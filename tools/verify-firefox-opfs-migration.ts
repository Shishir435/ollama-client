#!/usr/bin/env node

// Firefox MV2 mirror of tools/verify-opfs-migration.ts: end-to-end
// verification of the PRODUCTION OPFS persistence backend in real, packaged
// Firefox.
//
// Why this exists separately from spike-firefox-owner-gates.ts: that spike
// drives spike-owner.html, a purpose-built page that talks to the owner
// directly. It proves the MV2 owner topology works. It does not prove the
// production path works, because it never goes through the repository facade
// or the backend dispatcher. Chromium has had that stronger claim since
// verify-opfs-migration.ts; Firefox has not, and section 17 makes this mirror
// a prerequisite for removing the sql.js fallback — the legacy reader must not
// be deleted while one of two shipped browsers has no production-path
// lifecycle evidence.
//
// Scenarios are deliberately the same four as the Chromium runner, with the
// same check names, so the two reports diff directly:
//   1. Fresh profile: the owner boots, finds no legacy blob, initializes the
//      OPFS backend and flips the marker.
//   2. Production writes: two tabs append through the facade concurrently;
//      counts are exact (single-owner, no lost update).
//   3. Real migration: seed a legacy sql.js blob (section 9.8 fixture), clear
//      the backend marker, restart the browser on the same profile; the owner
//      migrates the blob, verifies row counts, flips the marker — and the blob
//      stays untouched as the rollback artifact.
//   4. Backup export comes from the OPFS owner and is a valid SQLite file.
//
// Firefox-specific mechanics, none of which the Chromium runner needs:
//   - The owner is the MV2 persistent background page, not an offscreen
//     document, so there is nothing to create and nothing to keep alive.
//   - The extension UUID is pinned through the extensions.webextensions.uuids
//     pref, because the moz-extension:// origin has to be knowable before
//     install and stable across the restart in scenario 3. OPFS and IndexedDB
//     are keyed to that origin; a fresh UUID would silently produce an empty
//     profile and a scenario 3 that passes for the wrong reason.
//   - The profile directory is passed with `-profile` so geckodriver reuses it
//     instead of minting a temporary one. Without this the restart starts from
//     a blank profile and there is no legacy blob left to migrate.
//   - A temporary add-on does not survive a browser restart, so it is
//     reinstalled after relaunch. With the UUID pinned, the origin — and
//     therefore the stored data — is the same one.
//   - Firefox 153 refuses `WebDriver:Navigate` to a moz-extension:// URL
//     ("Navigation ... is not allowed in this context"), and a content page
//     cannot reach one either without web_accessible_resources. The page is
//     therefore opened from Firefox's own chrome context with a system
//     principal, which requires geckodriver's `--allow-system-access`. This is
//     also why tools/spike-firefox-owner-gates.ts no longer runs as written;
//     see the note at the bottom of this file.
//
// Usage: pnpm verify:firefox-opfs-migration [--headful]
// Requires: pnpm benchmark:build:firefox (the verify page is dev-gated) and a
// local Firefox install (override the binary with FIREFOX_BIN).

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Builder, type WebDriver } from "selenium-webdriver"
import firefox from "selenium-webdriver/firefox"

const buildPath = resolve("build/firefox-mv2-benchmark")
const artifactDir = resolve("artifacts/persistence-benchmark")
const geckodriverBin = resolve("node_modules/.bin/geckodriver")
const firefoxBin =
  process.env.FIREFOX_BIN ?? "/Applications/Firefox.app/Contents/MacOS/firefox"
const headful = process.argv.includes("--headful")

// Must match browser_specific_settings.gecko.id in the built manifest.
const GECKO_ID = "shishirchaurasiya435@gmail.com"
// Any fixed UUID works; pinning it makes the moz-extension origin knowable
// before install and identical after the scenario 3 restart.
const UUID = "6c1c1f9e-2f5f-4c9a-9c11-000000abcdef"
const VERIFY_URL = `moz-extension://${UUID}/persistence-verify.html`

const FIXTURE_SESSIONS = 40
const FIXTURE_MESSAGES = 800
const APPENDS = 30

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

/**
 * Launch Firefox on a specific profile directory with the add-on installed.
 *
 * Called twice: once for the initial run and once after the scenario 3
 * restart. Both calls receive the same profileDir, which is what makes the
 * restart a restart rather than a fresh install.
 */
const launch = async (profileDir: string): Promise<WebDriver> => {
  const options = new firefox.Options()
  options.setBinary(firefoxBin)
  if (!headful) options.addArguments("-headless")
  // geckodriver uses this directory as-is instead of creating a temporary
  // profile, so IndexedDB and OPFS survive the relaunch.
  options.addArguments("-profile", profileDir)
  options.setPreference(
    "extensions.webextensions.uuids",
    JSON.stringify({ [GECKO_ID]: UUID })
  )
  options.setPreference("xpinstall.signatures.required", false)

  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(
      // Enables the chrome-context system principal that openVerifyTab needs.
      // It is a geckodriver flag: passing -remote-allow-system-access through
      // capabilities is rejected outright.
      new firefox.ServiceBuilder(geckodriverBin).addArguments(
        "--allow-system-access"
      )
    )
    .build()

  // installAddon is a Firefox-only command absent from the generic typings.
  await (
    driver as unknown as {
      installAddon: (path: string, temporary: boolean) => Promise<string>
    }
  ).installAddon(buildPath, true)

  return driver
}

/**
 * Open the verify page in a new tab and leave the driver focused on it.
 *
 * The tab is created from Firefox's chrome context with a system principal
 * rather than by navigating, because Firefox 153 rejects WebDriver navigation
 * to moz-extension:// outright. Returns the new tab's handle.
 *
 * Retried as a whole: immediately after installAddon the moz-extension origin
 * can still be starting up, and after the scenario 3 restart the background
 * page is mid-migration and may not answer yet.
 */
const openVerifyTab = async (
  driver: WebDriver,
  timeoutMs = 30000
): Promise<string> => {
  const context = driver as unknown as {
    setContext: (c: unknown) => Promise<void>
  }
  const deadline = Date.now() + timeoutMs

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

      const opened = await waitForNewHandle(driver, before, 10000)
      await driver.switchTo().window(opened)
      // Poll rather than checking once: addTab returns as soon as the tab
      // exists, well before the document has parsed and run main.ts.
      if (await waitForHooks(driver, 15000)) return opened
      await driver.close()
      await driver.switchTo().window([...before][0])
    } catch {
      // Restore the content context before retrying; a throw between the two
      // setContext calls would otherwise leave every later command aimed at
      // chrome and failing for an unrelated-looking reason.
      await context.setContext(firefox.Context.CONTENT).catch(() => {})
    }
    if (Date.now() > deadline) {
      throw new Error(`Verify page hooks never became ready at ${VERIFY_URL}`)
    }
    await sleep(500)
  }
}

const waitForHooks = async (
  driver: WebDriver,
  timeoutMs: number
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ready = await driver
      .executeScript<boolean>(
        "return document.getElementById('status')?.textContent === 'hooks-ready'"
      )
      .catch(() => false)
    if (ready) return true
    if (Date.now() > deadline) return false
    await sleep(250)
  }
}

const waitForNewHandle = async (
  driver: WebDriver,
  before: Set<string>,
  timeoutMs: number
): Promise<string> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const opened = (await driver.getAllWindowHandles()).find(
      (handle) => !before.has(handle)
    )
    if (opened) return opened
    if (Date.now() > deadline) throw new Error("No new tab appeared")
    await sleep(200)
  }
}

/** Call a __persistenceVerify hook in the active tab and await its result. */
const call = async <T>(
  driver: WebDriver,
  method: string,
  ...args: unknown[]
): Promise<T> => {
  const outcome = await driver.executeAsyncScript<
    { ok: true; result: T } | { ok: false; error: string }
  >(
    // biome-ignore lint/complexity/useArrowFunction: serialized into the page
    function (
      method: string,
      args: unknown[],
      done: (r: unknown) => void
    ) {
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

/**
 * Start a hook without awaiting it, parking the promise on the page.
 *
 * Scenario 2 needs two tabs writing at the same time. A WebDriver session
 * executes one command at a time, so `Promise.all` across two tabs — what the
 * Chromium runner does with two Playwright pages — is not available. Starting
 * each tab's write and collecting both afterwards produces the same overlap:
 * tab A's appends are in flight while tab B's are issued.
 */
const startCall = (
  driver: WebDriver,
  method: string,
  ...args: unknown[]
): Promise<void> =>
  driver.executeScript(
    // biome-ignore lint/complexity/useArrowFunction: serialized into the page
    function (method: string, args: unknown[]) {
      const target = window as unknown as {
        __persistenceVerify: Record<
          string,
          (...a: unknown[]) => Promise<unknown>
        >
        __pendingVerify?: Promise<unknown>
      }
      target.__pendingVerify = target.__persistenceVerify[method](...args)
    },
    method,
    args
  )

/** Await the promise parked by startCall in the active tab. */
const settleCall = async (driver: WebDriver): Promise<void> => {
  const outcome = await driver.executeAsyncScript<
    { ok: true } | { ok: false; error: string }
  >(
    // biome-ignore lint/complexity/useArrowFunction: serialized into the page
    function (done: (r: unknown) => void) {
      const pending = (window as unknown as { __pendingVerify?: Promise<unknown> })
        .__pendingVerify
      if (!pending) {
        done({ ok: false, error: "no pending call on this tab" })
        return
      }
      pending
        .then(() => done({ ok: true }))
        .catch((error: unknown) => done({ ok: false, error: String(error) }))
    }
  )
  if (!outcome.ok) throw new Error(`pending call failed: ${outcome.error}`)
}

const waitForOpfsMarker = async (
  driver: WebDriver,
  timeoutMs: number
): Promise<{ sourceCounts?: { sessions: number; messages: number } }> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const marker = await call<{ backend?: string } | null>(
      driver,
      "backendMarker"
    )
    if (marker?.backend === "opfs") {
      return marker as { sourceCounts?: { sessions: number; messages: number } }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Backend marker never became opfs: ${JSON.stringify(marker)}`
      )
    }
    await sleep(500)
  }
}

const runScenarios = async (): Promise<void> => {
  if (!existsSync(resolve(buildPath, "persistence-verify.html"))) {
    throw new Error(
      `Missing ${buildPath}/persistence-verify.html — run: pnpm benchmark:build:firefox`
    )
  }
  if (!existsSync(firefoxBin)) {
    throw new Error(
      `Firefox binary not found at ${firefoxBin} — set FIREFOX_BIN`
    )
  }

  const scratch = mkdtempSync(join(tmpdir(), "ollama-client-ff-opfs-"))
  const profileDir = join(scratch, "profile")
  mkdirSync(profileDir, { recursive: true })

  let driver = await launch(profileDir)

  try {
    // ---- 1. Fresh profile boots straight onto the OPFS backend ----
    let firstTab = await openVerifyTab(driver)
    const freshMarker = await waitForOpfsMarker(driver, 30000)
    const freshCounts = await call<{ sessions: number; messages: number }>(
      driver,
      "counts"
    )
    record(
      "fresh-profile-opfs-init",
      freshCounts.sessions === 0 && freshCounts.messages === 0,
      { freshMarker, freshCounts }
    )

    // ---- 2. Concurrent facade writes from two tabs, exact counts ----
    const secondTab = await openVerifyTab(driver)

    await driver.switchTo().window(firstTab)
    await startCall(driver, "appendViaFacade", "verify-a", APPENDS)
    await driver.switchTo().window(secondTab)
    await startCall(driver, "appendViaFacade", "verify-b", APPENDS)
    await settleCall(driver)
    await driver.switchTo().window(firstTab)
    await settleCall(driver)

    const afterWrites = await call<{ sessions: number; messages: number }>(
      driver,
      "counts"
    )
    record(
      "concurrent-facade-writes",
      afterWrites.sessions === 2 && afterWrites.messages === APPENDS * 2,
      { expected: APPENDS * 2, ...afterWrites }
    )

    await driver.switchTo().window(secondTab)
    await driver.close()
    await driver.switchTo().window(firstTab)

    // ---- 3. Real legacy-blob migration across a browser restart ----
    const seeded = await call<{
      sessions: number
      messages: number
      blobBytes: number
    }>(driver, "seedLegacyBlob", FIXTURE_SESSIONS, FIXTURE_MESSAGES)
    await call<void>(driver, "clearMarker")

    // A full restart on the same profile, matching the Chromium runner's
    // choice: the migration has to run on a cold boot, not on a soft reload.
    await driver.quit()
    await sleep(1500)
    driver = await launch(profileDir)
    firstTab = await openVerifyTab(driver)

    const migratedMarker = await waitForOpfsMarker(driver, 60000)
    const migratedCounts = await call<{ sessions: number; messages: number }>(
      driver,
      "counts"
    )
    const blobAfter = await call<number>(driver, "readLegacyBlobLength")
    record(
      "legacy-blob-migration-verified",
      migratedCounts.sessions === FIXTURE_SESSIONS &&
        migratedCounts.messages === FIXTURE_MESSAGES &&
        migratedMarker.sourceCounts?.sessions === FIXTURE_SESSIONS,
      { seeded, migratedMarker, migratedCounts }
    )
    record("rollback-blob-untouched", blobAfter === seeded.blobBytes, {
      blobAfter,
      seededBytes: seeded.blobBytes
    })

    // ---- 4. Backup export served by the OPFS owner ----
    const exportInfo = await call<{ byteLength: number; magic: string }>(
      driver,
      "exportInfo"
    )
    record(
      "export-from-opfs-owner",
      exportInfo.byteLength > 0 && exportInfo.magic === "SQLite format 3",
      exportInfo
    )
  } finally {
    await driver.quit().catch(() => {})
    rmSync(scratch, { recursive: true, force: true })
  }
}

const main = async (): Promise<void> => {
  await runScenarios()

  const report = {
    measuredAt: new Date().toISOString(),
    topology:
      "production OPFS single-owner backend; packaged Firefox MV2 background-page owner; real repository facade",
    results
  }
  mkdirSync(artifactDir, { recursive: true })
  const outputPath = resolve(
    artifactDir,
    `firefox-opfs-migration-${Date.now()}.json`
  )
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
