/**
 * A `setTimeout` that a cancellation can cut short.
 *
 * A plain awaited timeout is where cancellation quietly stops working: the
 * signal is checked before and after, so the caller keeps a pacing delay
 * running for its full duration after the work it paces has been abandoned,
 * and a batch loop pays that once per batch. Rejecting with `signal.reason`
 * preserves the abort as an abort, rather than surfacing later as whatever the
 * next step fails with.
 */
export const abortableDelay = (
  ms: number,
  signal?: AbortSignal
): Promise<void> => {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}
