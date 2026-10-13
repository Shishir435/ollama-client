/**
 * The harness's side of the model provider: retrying a provider that is
 * briefly down, and cancelling what an attempt left in flight.
 *
 * A provider 503 is the provider's failure, not the agent's. Passed straight
 * through, it ended the run, and the olc proxy's single-flight queue then
 * held every later request behind the one the harness walked away from: 18
 * of 40 qualification tasks timed out that way after one 503. Retrying before
 * any byte reaches the extension keeps the attempt measuring the agent, and
 * aborting at the attempt's end frees the queue for the next one.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Statuses a provider sends when it may answer if asked again. */
export const RETRYABLE_STATUSES = [408, 425, 429, 500, 502, 503, 504]

/**
 * Milliseconds to wait before try `retry` (1-based): `Retry-After` when the
 * provider names one, otherwise doubling from `baseDelayMs`, capped either way.
 */
export const backoffDelay = (
  retry,
  retryAfter,
  { baseDelayMs = 2000, maxDelayMs = 30_000 } = {}
) => {
  const seconds = Number(retryAfter)
  if (
    retryAfter != null &&
    String(retryAfter).trim() &&
    Number.isFinite(seconds)
  )
    return Math.min(maxDelayMs, Math.max(0, seconds * 1000))
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (retry - 1))
}

/**
 * Fetches `url`, retrying a network error or a retryable status up to
 * `retries` times. Only the status line has been read when a retry is
 * decided, so nothing of a failed answer has reached the caller. Resolves
 * `{ response, retries }` with the last response, or rejects with the last
 * network error; an aborted signal rejects at once and is never retried.
 */
export const fetchWithBackoff = async (
  url,
  init = {},
  { retries = 4, fetchImpl = fetch, wait = sleep, ...delays } = {}
) => {
  for (let retry = 0; ; retry += 1) {
    let response
    try {
      response = await fetchImpl(url, init)
    } catch (error) {
      if (init.signal?.aborted || retry >= retries) throw error
      await wait(backoffDelay(retry + 1, undefined, delays))
      continue
    }
    if (!RETRYABLE_STATUSES.includes(response.status) || retry >= retries)
      return { response, retries: retry }
    await response.body?.cancel().catch(() => {})
    await wait(
      backoffDelay(retry + 1, response.headers.get("retry-after"), delays)
    )
    if (init.signal?.aborted) throw init.signal.reason
  }
}

/**
 * Everything one attempt sent upstream, so the attempt's end can cancel
 * whatever is still streaming. A fresh scope per attempt; `abort` is safe to
 * call twice.
 */
export const createAttemptScope = () => {
  const controller = new AbortController()
  return {
    signal: controller.signal,
    abort: () => controller.abort(new Error("attempt ended"))
  }
}

/**
 * Whether the provider is up within `timeoutMs`, asked with back-off for its
 * model listing. A route it doesn't serve still counts as up; only no answer,
 * 429 or a 5xx counts as down. Checked before an attempt starts, so an attempt is never
 * spent on a provider that is down: that attempt is recorded as an
 * infrastructure failure instead, and still counted.
 */
export const waitForProvider = async (
  upstream,
  headers = {},
  { timeoutMs = 180_000, now = Date.now, wait = sleep, fetchImpl = fetch } = {}
) => {
  const deadline = now() + timeoutMs
  for (let retry = 1; ; retry += 1) {
    const healthy = await fetchImpl(`${upstream}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(15_000)
    }).then(
      async (response) => {
        await response.body?.cancel().catch(() => {})
        /** Any other answer, a 404 included, proves the server is up. */
        return !RETRYABLE_STATUSES.includes(response.status)
      },
      () => false
    )
    if (healthy) return true
    if (now() >= deadline) return false
    await wait(Math.min(backoffDelay(retry), Math.max(0, deadline - now())))
  }
}
