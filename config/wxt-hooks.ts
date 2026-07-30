import { resolve } from "node:path"
import type { defineConfig } from "wxt"

type WxtHooks = NonNullable<Parameters<typeof defineConfig>[0]["hooks"]>

/**
 * Entrypoints that exist only for the section 9.4/9.8 browser measurements.
 *
 * Never in a store package. `benchmark` and `spike-opfs` are the measurement
 * pages, `spike-owner`/`spike-owner-offscreen` are the owner-topology spike,
 * and `persistence-verify` drives the production OPFS path for
 * verify-opfs-migration.
 */
const DEV_ENTRYPOINTS = [
  "benchmark",
  "spike-opfs",
  "spike-owner",
  "spike-owner-offscreen",
  "persistence-verify"
] as const

export interface BuildTarget {
  /** WXT's resolved command; "serve" is `pnpm dev`. */
  command: string
  browser: string
  /** process.env.WXT_BENCHMARK, passed in rather than read, so this is pure. */
  benchmark: boolean
}

/**
 * Which entrypoints to remove for a given build.
 *
 * Pure so the matrix can be asserted directly — see
 * config/__tests__/wxt-build-config.test.ts. A store build stripping fewer dev
 * pages than it should is a shipping defect, and reading the answer off a
 * built bundle is a slow way to find out.
 */
export const devEntrypointsToStrip = (target: BuildTarget): string[] => {
  const includeDev = target.command === "serve" || target.benchmark

  /*
   * The owner-topology spike needs chrome.offscreen and
   * chrome.runtime.getContexts, which Firefox does not provide, so its
   * offscreen page is Chromium-only even in dev builds. Firefox keeps the
   * client page and hosts the owner in its persistent background page. The
   * measurement pages stay cross-browser.
   */
  const devOnly = includeDev
    ? target.browser === "firefox"
      ? ["spike-owner-offscreen"]
      : []
    : [...DEV_ENTRYPOINTS]

  // Chromium uses the persistence offscreen document for ingestion parsing.
  // Firefox needs a separate hidden page because loading file processors into
  // its persistent background page would add several megabytes.
  return target.browser === "firefox"
    ? [...devOnly, "persistence-host"]
    : [...devOnly, "ingestion-processor"]
}

/**
 * Remove the dev-only entrypoints for this build, in place.
 *
 * Exported so the wiring — including the WXT_BENCHMARK read, which is where
 * the PR #200 regression actually lived — can be exercised directly, rather
 * than by indexing into the hooks object below.
 */
export const stripDevEntrypoints = (
  command: string,
  browser: string,
  entrypoints: { name: string }[]
): void => {
  const strip = devEntrypointsToStrip({
    command,
    browser,
    benchmark: process.env.WXT_BENCHMARK === "1"
  })
  for (const name of strip) {
    const index = entrypoints.findIndex(
      (entrypoint) => entrypoint.name === name
    )
    if (index !== -1) entrypoints.splice(index, 1)
  }
}

export const hooks: WxtHooks = {
  "build:publicAssets": (_wxt, files) => {
    const promoIndex = files.findIndex(
      (file) => file.relativeDest === "assets/icon-promo-light.png"
    )
    if (promoIndex !== -1) files.splice(promoIndex, 1)
    // Ship the official sqlite3.wasm at a stable path: the persistence owner
    // host fetches it and hands bytes to its worker. Bundler ?url imports are
    // not portable here — Firefox MV2 iife output inlines the asset as a data:
    // URL, which fetch() rejects.
    files.push({
      absoluteSrc: resolve(
        "node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm"
      ),
      relativeDest: "assets/sqlite3.wasm"
    })
  },

  "entrypoints:resolved": (wxt, entrypoints) =>
    stripDevEntrypoints(wxt.config.command, wxt.config.browser, entrypoints)
}
