import { browser } from "@/lib/browser-api"
import type { EmbeddingConfig } from "@/lib/constants"
import { STORAGE_KEYS } from "@/lib/constants"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

/**
 * Embedding config is read from paths that run once per chunk and once per
 * vector operation — ingestion, retrieval, index add, index search — and every
 * read is a live `chrome.storage` round trip, because Plasmo does not cache.
 * Ingesting a file therefore spent thousands of IPC hops re-reading settings
 * that did not change for the duration of the job.
 *
 * The memo is invalidated from `storage.onChanged` rather than expiring on a
 * timer: a stale retrieval config silently changes what RAG returns, so
 * bounded staleness is not good enough. A context without the storage API
 * keeps reading every time, which is the behaviour this replaces.
 *
 * Registration is attempted once, lazily, so importing this module in a
 * context with no extension APIs stays inert.
 */
let cachedConfig: Promise<EmbeddingConfig> | null = null
let watcherRegistered = false
let watcherActive = false

const registerConfigWatcher = (): void => {
  if (watcherRegistered) return
  watcherRegistered = true
  try {
    const onChanged = browser.storage?.onChanged
    if (!onChanged?.addListener) return
    onChanged.addListener((changes) => {
      // Matched on key alone rather than area: the storage wrapper routes by
      // registry scope, and a key that moves between areas must still
      // invalidate.
      if (STORAGE_KEYS.EMBEDDINGS.CONFIG in changes) cachedConfig = null
    })
    watcherActive = true
  } catch {
    // No storage API here. Leave the memo disabled rather than risk serving a
    // config that can never be invalidated.
  }
}

/**
 * Gets embedding configuration.
 *
 * Memoized until the stored value changes. Callers on hot loops should still
 * resolve it once per operation and pass the snapshot down rather than calling
 * this per item — the memo removes the IPC, not the await.
 */
export const getEmbeddingConfig = async (): Promise<EmbeddingConfig> => {
  registerConfigWatcher()
  if (!watcherActive) return readSetting(SETTINGS.EMBEDDING_CONFIG)

  if (!cachedConfig) {
    cachedConfig = readSetting(SETTINGS.EMBEDDING_CONFIG).catch(
      (error: unknown) => {
        // A rejected read must not be memoized, or one transient failure
        // pins the error for the life of the context.
        cachedConfig = null
        throw error
      }
    )
  }
  return cachedConfig
}

/**
 * Drops the memo.
 *
 * For tests, and for a caller that has just written the config and needs its
 * own next read to reflect that without waiting for the change event.
 */
export const resetEmbeddingConfigCache = (): void => {
  cachedConfig = null
}
