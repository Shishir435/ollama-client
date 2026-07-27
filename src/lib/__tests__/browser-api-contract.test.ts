import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

/*
 * Production code must reach promise-returning extension APIs through
 * `browser` (webextension-polyfill), never through the `chrome` alias.
 *
 * Measured on real Firefox 153 (packaged MV2 extension page):
 *
 *   browser.storage.local.get("k")  -> Promise
 *   chrome.storage.local.get("k")   -> undefined
 *   chrome.storage.sync.get("k")    -> undefined
 *   chrome.permissions.getAll()     -> undefined
 *   chrome.tabs.query({})           -> undefined
 *   chrome.storage.local.set({...}) -> undefined  (the write still happens)
 *
 * Firefox implements the `chrome` namespace callback-only, so `await
 * chrome.storage.local.get(key)` resolves to undefined rather than the stored
 * object, and the property read that follows throws a TypeError. Writes are
 * unaffected, which is what makes this so quiet: state is saved and never read
 * back, so the failure looks like "the setting didn't stick" rather than an
 * error.
 *
 * That is not hypothetical. src/lib/persistence/backend.ts read the persistence
 * marker this way; the throw was swallowed by readPersistenceBackend's
 * catch-and-default, so every Firefox profile answered "legacy" forever and
 * never moved onto the OPFS SQLite backend it had already migrated to.
 *
 * Chromium-only APIs are exempt: they are guarded by a capability check and
 * never execute on Firefox, so the alias is accurate there.
 */

const SRC_DIR = join(__dirname, "../..")

/**
 * `chrome.<namespace>` uses that are allowed to remain.
 *
 * Everything here is either Chromium-exclusive (Firefox has no implementation
 * at all, so the call is behind a capability gate) or a synchronous call, which
 * behaves identically under both namespaces.
 */
const ALLOWED_NAMESPACES = new Set([
  // Chromium-exclusive.
  "offscreen",
  "sidePanel",
  "tabCapture",
  "declarativeNetRequest",
  // Synchronous, or presence-checked rather than called.
  "runtime"
])

/** Files exempt from the rule, with the reason recorded next to the path. */
const ALLOWED_FILES = new Set([
  // Defines the isChromiumBased/supports* gates the rest of the rule leans on;
  // probing `chrome` directly is the point of the module.
  "lib/browser-api.ts",
  // Chromium-only owner: creates and talks to the offscreen document.
  "lib/persistence/chromium-owner.ts",
  // Section 9.4 spike host, Chromium-only and dev-gated out of store builds.
  "spike/opfs/background-owner-host.ts",
  // States the rule in prose.
  "lib/__tests__/browser-api-contract.test.ts"
])

/**
 * Strip comments before matching.
 *
 * Several of these files explain the rule in prose and quote the very call
 * they are warning about; matching those would make documenting the hazard
 * fail the check that exists to enforce it.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const productionSources = (): string[] =>
  walk(SRC_DIR)
    .filter((path) => /\.(ts|tsx)$/.test(path))
    .filter((path) => !/\.d\.ts$/.test(path))
    .map((path) => relative(SRC_DIR, path).replace(/\\/g, "/"))
    .filter((path) => !path.includes("__tests__/"))
    .filter((path) => !path.startsWith("test/"))
    .filter((path) => !ALLOWED_FILES.has(path))

describe("extension API namespace contract", () => {
  it("never awaits a chrome.* call that is callback-only on Firefox", () => {
    const offenders: string[] = []

    for (const file of productionSources()) {
      const source = withoutComments(readFileSync(join(SRC_DIR, file), "utf-8"))
      const matches = source.matchAll(/await\s+chrome\.([a-zA-Z]+)\./g)
      for (const match of matches) {
        const namespace = match[1]
        if (ALLOWED_NAMESPACES.has(namespace)) continue
        const line = source.slice(0, match.index).split("\n").length
        offenders.push(`${file}:${line} — await chrome.${namespace}.*`)
      }
    }

    expect(offenders).toEqual([])
  })

  it("routes storage and permissions through browser, not chrome", () => {
    const offenders: string[] = []

    for (const file of productionSources()) {
      const source = withoutComments(readFileSync(join(SRC_DIR, file), "utf-8"))
      /*
       * Presence checks (`Boolean(chrome.storage)`) are fine, and so is event
       * registration: `chrome.storage.onChanged.addListener` takes a callback
       * by design and behaves identically under both namespaces on Firefox.
       * Only the promise-returning methods are affected.
       */
      const matches = source.matchAll(
        /\bchrome\.(storage|permissions)\??\.(?!onChanged)[a-zA-Z]+\??\.[a-zA-Z]/g
      )
      for (const match of matches) {
        const line = source.slice(0, match.index).split("\n").length
        offenders.push(`${file}:${line} — ${match[0]}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
