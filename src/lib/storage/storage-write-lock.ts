/**
 * Serialize a read-modify-write on a shared `chrome.storage` key across ALL
 * extension contexts (background service worker, side panel, options page).
 *
 * `chrome.storage` has no compare-and-swap: two contexts can read the same
 * stale map, patch different keys, and the later write clobbers the earlier
 * one. An in-memory promise chain only orders writes *within a single context*,
 * because each page loads its own module instance. The Web Locks API is scoped
 * per-origin and shared across every context of the extension, so a lock taken
 * in the options page blocks the side panel and vice versa.
 *
 * Supported extension targets provide Web Locks. If the API is unavailable,
 * fail closed: an in-memory queue would only protect one JavaScript realm and
 * would silently reintroduce lost updates between extension contexts.
 */

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

const getLockManager = (): LockManagerLike | null => {
  const nav = (globalThis as { navigator?: { locks?: unknown } }).navigator
  const locks = nav?.locks as LockManagerLike | undefined
  return locks && typeof locks.request === "function" ? locks : null
}

/**
 * Run `operation` while holding a named lock that is exclusive across every
 * extension context. Returns whatever `operation` resolves to.
 */
export const withStorageWriteLock = <T>(
  name: string,
  operation: () => Promise<T>
): Promise<T> => {
  const locks = getLockManager()
  if (!locks) {
    return Promise.reject(
      new Error("Cross-context storage locking is unavailable")
    )
  }
  return locks.request(name, operation)
}
