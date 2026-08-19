/**
 * Single-flight queue for backend requests.
 *
 * Why: one agent runtime drives one loop at a time, so overlapping chat turns
 * interleave events and confuse session bookkeeping. Requests are therefore
 * serialized, each with its own deadline so a stuck turn cannot hold the queue.
 *
 * A deadline cancels rather than abandons. Rejecting the caller while the task kept
 * running would leave work outside the single-flight boundary, so the task is handed
 * an `AbortSignal` and the slot is held until it actually unwinds — a task that is
 * still running has not left the boundary, whatever its caller was told.
 *
 * A cancelled task that does not stop is therefore never overtaken. After a bounded
 * grace period the queue declares itself stalled and refuses work outright: waiting
 * and arriving requests fail immediately with a `QueueStalledError` naming the task
 * that will not stop. The alternatives are both worse — starting the next request
 * interleaves two live turns, and queueing behind a task that may never settle hangs
 * every caller with no explanation. The queue heals itself if the task ever settles.
 */

/** Time a cancelled task is given to unwind before the queue declares itself stalled. */
const CANCEL_GRACE_MS = 10_000

/** Raised when a cancelled task is still running and nothing else may start. */
export class QueueStalledError extends Error {
  constructor(label: string) {
    super(
      `The previous request ("${label}") has not stopped since it was cancelled, so this one cannot start without overlapping it. The runtime may need a restart.`
    )
    this.name = "QueueStalledError"
  }
}

interface QueueEntry {
  task: (signal: AbortSignal) => Promise<unknown>
  timeoutMs: number
  label: string
  queuedAt: number
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export type RequestQueue = <T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs?: number,
  label?: string
) => Promise<T>

export const createRequestQueue = ({
  defaultTimeoutMs = 120_000,
  cancelGraceMs = CANCEL_GRACE_MS
}: {
  defaultTimeoutMs?: number
  cancelGraceMs?: number
} = {}): RequestQueue => {
  const queue: QueueEntry[] = []
  let isProcessing = false
  /** The cancelled task that will not stop, while it will not stop. */
  let stalled: QueueEntry | null = null

  const failWaiting = (label: string) => {
    while (queue.length > 0) {
      const waiting = queue.shift() as QueueEntry
      waiting.reject(new QueueStalledError(label))
    }
  }

  const processQueue = () => {
    if (isProcessing || queue.length === 0) return
    isProcessing = true

    const entry = queue.shift() as QueueEntry
    const waitedMs = Date.now() - entry.queuedAt
    if (waitedMs > 50) {
      console.log(
        `[Proxy][Queue] Starting "${entry.label}" after waiting ${waitedMs}ms (queue depth now ${queue.length})`
      )
    }

    let settled = false
    let graceId: NodeJS.Timeout | undefined
    const controller = new AbortController()
    const startedAt = Date.now()

    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      console.error(
        `[Proxy][Queue] "${entry.label}" timed out after ${entry.timeoutMs}ms`
      )
      controller.abort(new Error(`Request timeout after ${entry.timeoutMs}ms`))
      entry.reject(new Error(`Request timeout after ${entry.timeoutMs}ms`))
      graceId = setTimeout(() => {
        console.error(
          `[Proxy][Queue] "${entry.label}" is still running ${cancelGraceMs}ms after cancellation; refusing further requests until it stops`
        )
        stalled = entry
        failWaiting(entry.label)
      }, cancelGraceMs)
      if (typeof graceId.unref === "function") graceId.unref()
    }, entry.timeoutMs)
    if (typeof timeoutId.unref === "function") timeoutId.unref()

    Promise.resolve()
      .then(() => entry.task(controller.signal))
      .then((result) => {
        if (settled) return
        settled = true
        entry.resolve(result)
      })
      .catch((error) => {
        if (settled) return
        settled = true
        entry.reject(error)
      })
      .finally(() => {
        clearTimeout(timeoutId)
        if (graceId) clearTimeout(graceId)
        if (stalled === entry) {
          console.log(
            `[Proxy][Queue] "${entry.label}" finally stopped; accepting requests again`
          )
          stalled = null
        }
        console.log(
          `[Proxy][Queue] Finished "${entry.label}" in ${Date.now() - startedAt}ms`
        )
        isProcessing = false
        setTimeout(processQueue, 100)
      })
  }

  return <T>(
    task: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number = defaultTimeoutMs,
    label = "task"
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (stalled) {
        reject(new QueueStalledError(stalled.label))
        return
      }
      queue.push({
        task: task as (signal: AbortSignal) => Promise<unknown>,
        timeoutMs,
        label,
        queuedAt: Date.now(),
        resolve: resolve as (value: unknown) => void,
        reject
      })
      if (queue.length > 1) {
        console.log(
          `[Proxy][Queue] "${label}" queued behind ${queue.length - 1} pending request(s)`
        )
      }
      processQueue()
    })
}
