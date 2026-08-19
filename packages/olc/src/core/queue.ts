/**
 * Single-flight queue for OpenCode requests.
 *
 * Why: one OpenCode instance drives one agent loop at a time, so overlapping chat
 * turns interleave events and confuse session bookkeeping. Requests are therefore
 * serialized, each with its own deadline so a stuck turn cannot hold the queue.
 */

interface QueueEntry {
  task: () => Promise<unknown>
  timeoutMs: number
  label: string
  queuedAt: number
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export type RequestQueue = <T>(
  task: () => Promise<T>,
  timeoutMs?: number,
  label?: string
) => Promise<T>

export const createRequestQueue = ({
  defaultTimeoutMs = 120_000
}: {
  defaultTimeoutMs?: number
} = {}): RequestQueue => {
  const queue: QueueEntry[] = []
  let isProcessing = false

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
    const startedAt = Date.now()
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      console.error(
        `[Proxy][Queue] "${entry.label}" timed out after ${entry.timeoutMs}ms`
      )
      entry.reject(new Error(`Request timeout after ${entry.timeoutMs}ms`))
    }, entry.timeoutMs)

    Promise.resolve()
      .then(() => entry.task())
      .then((result) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        entry.resolve(result)
      })
      .catch((error) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        entry.reject(error)
      })
      .finally(() => {
        console.log(
          `[Proxy][Queue] Finished "${entry.label}" in ${Date.now() - startedAt}ms`
        )
        isProcessing = false
        setTimeout(processQueue, 100)
      })
  }

  return <T>(
    task: () => Promise<T>,
    timeoutMs: number = defaultTimeoutMs,
    label = "task"
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push({
        task: task as () => Promise<unknown>,
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
