#!/usr/bin/env node

// Section 9.4 spike: packaged-Firefox verification of the MV2 owner host.
// Installs build/firefox-mv2-benchmark as a temporary add-on in real Firefox
// via geckodriver, opens spike-owner.html on the real moz-extension:// origin
// (fixed internal UUID via the extensions.webextensions.uuids pref), and
// drives the owner RPC end to end: durable appends, checkpoint roundtrip,
// worker-termination recovery, verified export, and transaction rollback.
//
// Usage: pnpm spike:firefox-owner-gates [--headful]
// Requires: pnpm benchmark:build:firefox and a local Firefox install
// (override the binary with FIREFOX_BIN).

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Builder } from "selenium-webdriver"
import firefox from "selenium-webdriver/firefox"

const buildPath = resolve("build/firefox-mv2-benchmark")
const artifactDir = resolve("artifacts/persistence-benchmark")
const geckodriverBin = resolve("node_modules/.bin/geckodriver")
const firefoxBin =
  process.env.FIREFOX_BIN ?? "/Applications/Firefox.app/Contents/MacOS/firefox"
const headful = process.argv.includes("--headful")

const GECKO_ID = "shishirchaurasiya435@gmail.com"
// Any fixed UUID works; pinning it makes the moz-extension origin knowable
// before install.
const UUID = "6c1c1f9e-2f5f-4c9a-9c11-000000abcdef"

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

interface RpcResult {
  ok: boolean
  result?: any
  error?: string
}

const main = async (): Promise<void> => {
  if (!existsSync(resolve(buildPath, "spike-owner.html"))) {
    throw new Error(
      `Missing ${buildPath}/spike-owner.html — run: pnpm benchmark:build:firefox`
    )
  }
  if (!existsSync(firefoxBin)) {
    throw new Error(
      `Firefox binary not found at ${firefoxBin} — set FIREFOX_BIN`
    )
  }

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
    .setFirefoxService(new firefox.ServiceBuilder(geckodriverBin))
    .build()

  try {
    // Firefox-specific command missing from the generic WebDriver typings.
    await (
      driver as unknown as {
        installAddon: (path: string, temporary: boolean) => Promise<string>
      }
    ).installAddon(buildPath, true)
    await driver.get(`moz-extension://${UUID}/spike-owner.html`)

    const rpc = (op: string, payload?: unknown): Promise<RpcResult> =>
      driver.executeAsyncScript(
        // biome-ignore lint/complexity/useArrowFunction: serialized into the page
        function (op: string, payload: unknown, done: (r: unknown) => void) {
          ;(
            window as unknown as {
              __spikeOwner: (op: string, payload?: unknown) => Promise<unknown>
            }
          )
            .__spikeOwner(op, payload)
            .then((result) => done({ ok: true, result }))
            .catch((error) => done({ ok: false, error: String(error) }))
        },
        op,
        payload
      ) as Promise<RpcResult>

    const reset = await rpc("reset")
    record("mv2-owner-reachable", reset.ok === true, reset)

    const info = await rpc("ownerInfo")
    record(
      "mv2-owner-info",
      info.ok && typeof info.result?.ownerId === "string",
      info
    )

    const APPENDS = 25
    let appendsOk = true
    for (let seq = 0; seq < APPENDS; seq += 1) {
      const appended = await rpc("append", { writer: "ff-writer", seq })
      if (!appended.ok) {
        appendsOk = false
        record("mv2-appends", false, appended)
        break
      }
    }
    const counts = await rpc("counts")
    record(
      "mv2-appends-durable",
      appendsOk && counts.ok && counts.result?.byWriter?.["ff-writer"] === APPENDS,
      counts
    )

    const checkpoint = await rpc("upsertCheckpoint", {
      requestId: "ff-check",
      state: "s".repeat(2048)
    })
    const reread = await rpc("readCheckpoint", { requestId: "ff-check" })
    record(
      "mv2-checkpoint-roundtrip",
      checkpoint.ok && reread.ok && reread.result?.state?.length === 2048,
      { checkpoint: checkpoint.ok, stateLength: reread.result?.state?.length }
    )

    // Worker-termination recovery — Chromium's owner-close analog on MV2.
    const kill = await rpc("terminateWorker")
    const afterKill = await rpc("counts")
    record(
      "mv2-worker-termination-recovery",
      kill.ok &&
        afterKill.ok &&
        afterKill.result?.byWriter?.["ff-writer"] === APPENDS,
      { kill: kill.ok, after: afterKill.result?.byWriter }
    )

    const exported = await rpc("exportDb")
    record(
      "mv2-export-verified",
      exported.ok &&
        exported.result?.exportedBytes > 0 &&
        exported.result?.verifiedTotal === APPENDS,
      exported.result ?? exported
    )

    const pre = await rpc("counts")
    const hang = await rpc("beginHang")
    await rpc("terminateWorker")
    const post = await rpc("counts")
    record(
      "mv2-transaction-rollback-on-crash",
      hang.ok &&
        hang.result?.uncommittedTotal === (pre.result?.total ?? -1) + 1 &&
        post.result?.total === pre.result?.total,
      {
        pre: pre.result?.total,
        uncommitted: hang.result?.uncommittedTotal,
        post: post.result?.total
      }
    )

    await rpc("reset")
  } finally {
    await driver.quit()
  }

  const report = {
    measuredAt: new Date().toISOString(),
    topology:
      "Firefox MV2 persistent background page owning one sqlite-wasm opfs-sahpool worker; runtime-message RPC; real moz-extension origin",
    results
  }
  mkdirSync(artifactDir, { recursive: true })
  const outputPath = resolve(
    artifactDir,
    `spike-firefox-owner-${Date.now()}.json`
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
