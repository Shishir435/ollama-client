import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { PERSISTENCE_MARKER } from "./protocol"

// Which persistence backend this profile runs on. "legacy" is the historical
// in-memory sql.js database persisted as one IndexedDB blob; "opfs" is the
// single-owner sqlite-wasm database. The marker flips exactly once, after the
// owner has physically imported and verified the legacy blob. The legacy blob
// itself is never deleted by the migration — it is the rollback artifact.

export type PersistenceBackend = "legacy" | "opfs"

interface BackendMarker {
  backend: PersistenceBackend
  migratedAt?: number
  sourceCounts?: { sessions: number; messages: number }
}

let cachedBackend: PersistenceBackend | null = null

// Offscreen documents expose runtime messaging but not chrome.storage; the
// background answers marker reads/writes on their behalf.
const hasStorageApi = (): boolean =>
  typeof chrome !== "undefined" && Boolean(chrome.storage?.local)

const readMarkerRaw = async (): Promise<BackendMarker | undefined> => {
  if (hasStorageApi()) {
    const stored = await chrome.storage.local.get(
      STORAGE_KEYS.PERSISTENCE.BACKEND
    )
    return stored[STORAGE_KEYS.PERSISTENCE.BACKEND] as BackendMarker | undefined
  }
  const response = (await browser.runtime.sendMessage({
    type: PERSISTENCE_MARKER,
    action: "get"
  })) as { ok: boolean; marker?: BackendMarker; error?: string } | undefined
  if (!response?.ok) {
    throw new Error(response?.error ?? "Marker read message dropped")
  }
  return response.marker
}

const writeMarkerRaw = async (marker: BackendMarker): Promise<void> => {
  if (hasStorageApi()) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PERSISTENCE.BACKEND]: marker
    })
    return
  }
  const response = (await browser.runtime.sendMessage({
    type: PERSISTENCE_MARKER,
    action: "set",
    marker
  })) as { ok: boolean; error?: string } | undefined
  if (!response?.ok) {
    throw new Error(response?.error ?? "Marker write message dropped")
  }
}

export const readPersistenceBackend = async (): Promise<PersistenceBackend> => {
  if (cachedBackend) return cachedBackend
  try {
    const marker = await readMarkerRaw()
    cachedBackend = marker?.backend === "opfs" ? "opfs" : "legacy"
  } catch (error) {
    logger.warn("Failed to read persistence backend marker", "Persistence", {
      error
    })
    cachedBackend = "legacy"
  }
  return cachedBackend
}

export const markOpfsBackend = async (details: {
  sourceCounts?: { sessions: number; messages: number }
}): Promise<void> => {
  const marker: BackendMarker = {
    backend: "opfs",
    migratedAt: Date.now(),
    sourceCounts: details.sourceCounts
  }
  await writeMarkerRaw(marker)
  cachedBackend = "opfs"
}

/** Test hook and backup-import hook: drop the in-context cache so the next
 * read hits storage again. */
export const invalidateBackendCache = (): void => {
  cachedBackend = null
}
