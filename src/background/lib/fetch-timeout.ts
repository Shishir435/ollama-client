/**
 * Abort-timer for long-running fetches (v0.11.3 / F1 — lifecycle hardening).
 *
 * MV3 background fetches with no timeout can hang indefinitely (a provider that
 * never responds keeps the request — and any awaiting job — alive forever). This
 * arms a timer that calls `controller.abort()` after `ms` unless cleared first.
 *
 * `timedOut()` distinguishes a timeout-driven abort from a user-initiated cancel
 * so callers can surface the right message instead of "cancelled".
 *
 * Usage — connect timeout for a stream (clear once headers arrive, then stream
 * uncapped):
 *   const t = createAbortTimeout(controller, 60_000)
 *   const res = await fetch(url, { signal: controller.signal })
 *   t.clear()
 *
 * Usage — overall cap for a non-streaming request (clear in finally):
 *   const t = createAbortTimeout(controller, 900_000)
 *   try { return await fetch(url, { signal: controller.signal }) }
 *   finally { t.clear() }
 */
export interface AbortTimeout {
  /** Cancel the pending abort timer. Safe to call multiple times. */
  clear: () => void
  /** True once the timer fired and aborted (vs. an external cancel). */
  timedOut: () => boolean
}

export const createAbortTimeout = (
  controller: AbortController,
  ms: number
): AbortTimeout => {
  let didTimeout = false
  const id = setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, ms)
  return {
    clear: () => clearTimeout(id),
    timedOut: () => didTimeout
  }
}

/** Initial-connection cap for a streaming model pull. */
export const PULL_CONNECT_TIMEOUT_MS = 60_000

/** Overall cap for the silent, non-streaming embedding-model download. */
export const EMBEDDING_DOWNLOAD_TIMEOUT_MS = 15 * 60_000
