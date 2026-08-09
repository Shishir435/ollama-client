import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type {
  IntegrityReport,
  TableCountMismatch,
  TableCounts
} from "./durable-tables"
import {
  PERSISTENCE_MARKER,
  PersistenceStateResponseSchema,
  type PersistenceStateScope
} from "./protocol"

/**
 * Active chat persistence topology. `legacy` is the historical sql.js image;
 * `opfs` is the single-owner sqlite-wasm database. Migration flips the marker
 * only after verified import and retains the legacy blob as rollback evidence.
 */
export type PersistenceBackend = "legacy" | "opfs"

interface BackendMarker {
  backend: PersistenceBackend
  migratedAt?: number
  sourceCounts?: { sessions: number; messages: number }
}

export type MigrationOutcome = "migrated" | "fresh" | "failed" | "skipped"

export interface MigrationReceipt {
  version: 1
  outcome: MigrationOutcome
  recordedAt: number
  /** Extension version that performed the attempt. */
  extensionVersion: string
  /** How many attempts this profile has recorded, including this one. */
  attempts: number
  sourceSchemaVersion?: number
  sourceBytes?: number
  sourceCounts?: TableCounts
  importedCounts?: TableCounts
  sourceIntegrity?: IntegrityReport
  importedIntegrity?: IntegrityReport
  mismatches?: TableCountMismatch[]
  failure?: string
}

const STORAGE_KEY_BY_SCOPE: Record<PersistenceStateScope, string> = {
  backend: STORAGE_KEYS.PERSISTENCE.BACKEND,
  receipt: STORAGE_KEYS.PERSISTENCE.MIGRATION_RECEIPT,
  override: STORAGE_KEYS.PERSISTENCE.LEGACY_OVERRIDE
}

/**
 * Only "opfs" is cached permanently — it is the terminal state. "legacy" is
 * transitional (the owner may flip the marker at any moment), so it is
 * re-read on demand and the cache is invalidated live through
 * storage.onChanged where the API exists. Pinning "legacy" for a page's
 * lifetime would keep it writing the rollback blob after migration —
 * split-brain history.
 */
let cachedBackend: PersistenceBackend | null = null
let cachedOverride: boolean | null = null

let watcherRegistered = false
const registerMarkerWatcher = (): void => {
  if (watcherRegistered) return
  watcherRegistered = true
  try {
    browser.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local") return
      if (STORAGE_KEYS.PERSISTENCE.BACKEND in changes) cachedBackend = null
      if (STORAGE_KEYS.PERSISTENCE.LEGACY_OVERRIDE in changes) {
        cachedOverride = null
      }
    })
  } catch {
    // Contexts without storage (offscreen host) flip the cache themselves
    // through markOpfsBackend.
  }
}

/**
 * Offscreen documents expose runtime messaging but not storage; the background
 * answers these reads/writes on their behalf.
 *
 * Probed through `browser` — the promise-based polyfill — and not the `chrome`
 * alias. On Firefox `chrome` is callback-only, so `await chrome.storage.local
 * .get(key)` resolves to undefined and the property read below throws. That
 * threw on every marker read, readPersistenceBackend swallowed it and answered
 * "legacy", and Firefox therefore never left the sql.js blob backend.
 */
const hasStorageApi = (): boolean => Boolean(browser.storage?.local)

const readState = async <T>(
  scope: PersistenceStateScope
): Promise<T | undefined> => {
  const key = STORAGE_KEY_BY_SCOPE[scope]
  if (hasStorageApi()) {
    const stored = await browser.storage.local.get(key)
    return stored[key] as T | undefined
  }
  const rawResponse = await browser.runtime.sendMessage({
    type: PERSISTENCE_MARKER,
    action: "get",
    scope
  })
  const response = PersistenceStateResponseSchema.safeParse(rawResponse)
  if (!response.success) {
    throw new Error(`${scope} read returned an invalid response`)
  }
  if (!response.data.ok) throw new Error(response.data.error)
  return response.data.value as T | undefined
}

const writeState = async (
  scope: PersistenceStateScope,
  value: unknown
): Promise<void> => {
  if (hasStorageApi()) {
    await browser.storage.local.set({ [STORAGE_KEY_BY_SCOPE[scope]]: value })
    return
  }
  const rawResponse = await browser.runtime.sendMessage({
    type: PERSISTENCE_MARKER,
    action: "set",
    scope,
    value
  })
  const response = PersistenceStateResponseSchema.safeParse(rawResponse)
  if (!response.success) {
    throw new Error(`${scope} write returned an invalid response`)
  }
  if (!response.data.ok) throw new Error(response.data.error)
}

/**
 * Whether the operator switch pins this device to the legacy blob.
 *
 * A failed read answers false: absent is the normal state, and answering true
 * on a transient storage error would send a migrated profile back to a stale
 * blob — split-brain history from a glitch.
 */
export const readLegacyOverride = async (): Promise<boolean> => {
  if (cachedOverride !== null) return cachedOverride
  try {
    cachedOverride = (await readState<boolean>("override")) === true
    return cachedOverride
  } catch (error) {
    logger.warn("Failed to read persistence legacy override", "Persistence", {
      error
    })
    return false
  }
}

/** Operator recovery switch. Enabling it returns this device to the retained
 * legacy blob; the migration stays skipped for as long as it is set. */
export const setLegacyOverride = async (enabled: boolean): Promise<void> => {
  await writeState("override", enabled)
  cachedOverride = enabled
  cachedBackend = null
}

export const readPersistenceBackend = async (): Promise<PersistenceBackend> => {
  registerMarkerWatcher()
  // Checked before the "opfs" cache: the switch has to take effect in a
  // context that already resolved the terminal state.
  if (await readLegacyOverride()) return "legacy"
  if (cachedBackend === "opfs") return cachedBackend
  try {
    const marker = await readState<BackendMarker>("backend")
    cachedBackend = marker?.backend === "opfs" ? "opfs" : "legacy"
    return cachedBackend
  } catch (error) {
    // Never cache a failed read: answer legacy for this call only, so a
    // transient storage error cannot pin a context to the wrong backend.
    logger.warn("Failed to read persistence backend marker", "Persistence", {
      error
    })
    return "legacy"
  }
}

export const markOpfsBackend = async (details: {
  sourceCounts?: { sessions: number; messages: number }
}): Promise<void> => {
  const marker: BackendMarker = {
    backend: "opfs",
    migratedAt: Date.now(),
    sourceCounts: details.sourceCounts
  }
  await writeState("backend", marker)
  cachedBackend = "opfs"
}

export const readMigrationReceipt =
  async (): Promise<MigrationReceipt | null> => {
    try {
      return (await readState<MigrationReceipt>("receipt")) ?? null
    } catch (error) {
      logger.warn("Failed to read migration receipt", "Persistence", { error })
      return null
    }
  }

/**
 * Read through the `chrome` alias: getManifest is synchronous, so the
 * callback-vs-promise split that forces `browser` elsewhere does not apply, and
 * the polyfill did not answer it in the offscreen owner — every receipt written
 * there recorded the version as "unknown".
 */
const extensionVersion = (): string => {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    try {
      return browser.runtime.getManifest().version
    } catch {
      return "unknown"
    }
  }
}

/**
 * Record a migration attempt. Never throws: a receipt is evidence, and losing
 * it must not fail an otherwise good migration or mask the real failure of a
 * bad one.
 */
export const writeMigrationReceipt = async (
  details: Omit<
    MigrationReceipt,
    "version" | "recordedAt" | "extensionVersion" | "attempts"
  >
): Promise<void> => {
  try {
    const previous = await readMigrationReceipt()
    const receipt: MigrationReceipt = {
      ...details,
      version: 1,
      recordedAt: Date.now(),
      extensionVersion: extensionVersion(),
      attempts: (previous?.attempts ?? 0) + 1
    }
    await writeState("receipt", receipt)
  } catch (error) {
    logger.warn("Failed to write migration receipt", "Persistence", { error })
  }
}

/** Test hook and backup-import hook: drop the in-context cache so the next
 * read hits storage again. */
export const invalidateBackendCache = (): void => {
  cachedBackend = null
  cachedOverride = null
}
