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
 * Where the Web Locks API is unavailable (test/legacy environments) this falls
 * back to a per-context in-memory queue — still correct within one context,
 * which is all a single-context environment has.
 */

type LockGrantedCallback = () => Promise<unknown>
interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

const inProcessQueues = new Map<string, Promise<unknown>>()

const enqueueInProcess = <T>(
  name: string,
  operation: () => Promise<T>
): Promise<T> => {
  const previous = inProcessQueues.get(name) ?? Promise.resolve()
  const result = previous.then(operation, operation)
  // Keep the chain alive regardless of whether an individual op rejects.
  inProcessQueues.set(
    name,
    result.then(
      () => undefined,
      () => undefined
    )
  )
  return result
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
  if (locks) {
    return locks.request(name, operation as LockGrantedCallback) as Promise<T>
  }
  return enqueueInProcess(name, operation)
}
