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
 * A cancelled task that does not stop is therefore not overtaken straight away.
 * After a bounded grace period the queue declares itself stalled and refuses work:
 * waiting and arriving requests fail immediately with a `QueueStalledError` naming
 * the task that will not stop. The alternatives are both worse — starting the next
 * request interleaves two live turns, and queueing behind a task that may never
 * settle hangs every caller with no explanation.
 *
 * Refusing forever is worse still. A task that ignores its abort — an SDK call with
 * no cancellation, a poll loop reading a session that is already gone — used to wedge
 * the proxy for the life of the process, because the slot was released only from the
 * task's own `finally`. After `forceReleaseMs` the slot is released regardless and
 * the abandoned task is written off: whatever it is doing, it has been outside every
 * deadline the caller had, and a proxy that serves the next request is worth more
 * than one that guards a turn nobody is waiting for. The orphan's late `finally` is
 * identity-guarded so it cannot clear state that now belongs to a newer task.
 *
 * A caller can also leave. Its `signal` is honoured at both stages, because they are
 * not the same problem: a request still queued has started nothing, so it is simply
 * dropped and nothing runs on its behalf. A request already running is cancelled the
 * way a deadline cancels it — the task is aborted and the slot is held until it
 * unwinds — since a task whose caller is gone is still inside the single-flight
 * boundary until it stops.
 */

/** Time a cancelled task is given to unwind before the queue declares itself stalled. */
const CANCEL_GRACE_MS = 10_000

/**
 * Time a cancelled task is given before its slot is released regardless.
 *
 * Long enough that a turn which merely unwinds slowly is waited for rather than
 * duplicated, and short enough that a client which retries after its own deadline
 * is served instead of meeting the same refusal for the life of the process.
 */
const FORCE_RELEASE_MS = 60_000

/** Raised when the caller withdrew before its request could be served. */
export class ClientClosedError extends Error {
  constructor(label: string) {
    super(`The client closed the connection before "${label}" was served.`)
    this.name = "ClientClosedError"
  }
}

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
  signal?: AbortSignal
  /** Drops whichever stage's abort listener is currently attached. */
  detach?: () => void
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export interface RequestQueueOptions {
  timeoutMs?: number
  label?: string
  /** Aborted when the caller is gone: see the stage rules above. */
  signal?: AbortSignal
}

/**
 * What the queue is holding, for the health endpoint and for tests.
 *
 * Labels are request ids by convention; nothing here carries prompt text,
 * session ids or credentials, because `/health` is authentication-exempt.
 */
export interface QueueInspection {
  /** Whether a task holds the single-flight slot right now. */
  running: boolean
  runningLabel: string | null
  runningForMs: number | null
  /** Requests waiting for the slot. */
  depth: number
  stalled: boolean
  stalledLabel: string | null
  stalledForMs: number | null
  /** Cancelled tasks whose slot was force-released and that have not settled. */
  orphaned: number
  lastFailure: { label: string; reason: string; agoMs: number } | null
}

export interface RequestQueue {
  <T>(
    task: (signal: AbortSignal) => Promise<T>,
    options?: RequestQueueOptions
  ): Promise<T>
  inspect: () => QueueInspection
}

export const createRequestQueue = ({
  defaultTimeoutMs = 120_000,
  cancelGraceMs = CANCEL_GRACE_MS,
  forceReleaseMs = FORCE_RELEASE_MS
}: {
  defaultTimeoutMs?: number
  cancelGraceMs?: number
  forceReleaseMs?: number
} = {}): RequestQueue => {
  const queue: QueueEntry[] = []
  /** The entry holding the slot, or null. Identity, not a flag, so a late
   * `finally` from a force-released task cannot release a newer task's slot. */
  let running: QueueEntry | null = null
  let runningSince = 0
  /** The cancelled task that will not stop, while it will not stop. */
  let stalled: QueueEntry | null = null
  let stalledSince = 0
  /** Cancelled tasks whose slot was released before they settled. */
  const orphaned = new Set<QueueEntry>()
  let lastFailure: { label: string; reason: string; at: number } | null = null

  const failWaiting = (label: string) => {
    while (queue.length > 0) {
      const waiting = queue.shift() as QueueEntry
      waiting.detach?.()
      waiting.reject(new QueueStalledError(label))
    }
  }

  const processQueue = () => {
    if (running || queue.length === 0) return

    const entry = queue.shift() as QueueEntry
    running = entry
    runningSince = Date.now()
    entry.detach?.()
    const waitedMs = Date.now() - entry.queuedAt
    if (waitedMs > 50) {
      console.log(
        `[Proxy][Queue] Starting "${entry.label}" after waiting ${waitedMs}ms (queue depth now ${queue.length})`
      )
    }

    let settled = false
    let graceId: NodeJS.Timeout | undefined
    let releaseId: NodeJS.Timeout | undefined
    const controller = new AbortController()
    const startedAt = Date.now()

    /**
     * Release the slot without the task's cooperation.
     *
     * Everything the caller could be told has already been said, and every
     * deadline it had has passed. What is left is a choice between serving the
     * next request and refusing every request from here on, and only one of
     * those is a working proxy.
     */
    const forceRelease = () => {
      const heldMs = Math.max(cancelGraceMs, forceReleaseMs)
      console.error(
        `[Proxy][Queue] "${entry.label}" has not stopped ${heldMs}ms after cancellation; releasing its slot and accepting requests again. Anything it still produces is discarded.`
      )
      orphaned.add(entry)
      if (stalled === entry) {
        stalled = null
        stalledSince = 0
      }
      if (running === entry) {
        running = null
        processQueue()
      }
    }

    /**
     * One cancellation path for both reasons a running task is ended. The slot
     * is held either way: the caller has its answer, but the task has not left
     * the boundary until it unwinds, and the grace timer is what turns "will
     * not stop" into a refusal instead of an overlap.
     */
    const cancelRunning = (error: Error, reason: string) => {
      if (settled) return
      settled = true
      controller.abort(error)
      entry.reject(error)
      lastFailure = { label: entry.label, reason, at: Date.now() }
      graceId = setTimeout(() => {
        console.error(
          `[Proxy][Queue] "${entry.label}" is still running ${cancelGraceMs}ms after cancellation; refusing further requests until it stops`
        )
        stalled = entry
        stalledSince = Date.now()
        failWaiting(entry.label)
      }, cancelGraceMs)
      if (typeof graceId.unref === "function") graceId.unref()
      releaseId = setTimeout(
        forceRelease,
        Math.max(cancelGraceMs, forceReleaseMs)
      )
      if (typeof releaseId.unref === "function") releaseId.unref()
    }

    const timeoutId = setTimeout(() => {
      if (settled) return
      console.error(
        `[Proxy][Queue] "${entry.label}" timed out after ${entry.timeoutMs}ms`
      )
      cancelRunning(
        new Error(`Request timeout after ${entry.timeoutMs}ms`),
        "timeout"
      )
    }, entry.timeoutMs)
    if (typeof timeoutId.unref === "function") timeoutId.unref()

    if (entry.signal) {
      const signal = entry.signal
      const onCallerGone = () => {
        if (settled) return
        console.log(
          `[Proxy][Queue] "${entry.label}" lost its client while running; cancelling it`
        )
        cancelRunning(new ClientClosedError(entry.label), "client-closed")
      }
      signal.addEventListener("abort", onCallerGone, { once: true })
      entry.detach = () => signal.removeEventListener("abort", onCallerGone)
      if (signal.aborted) onCallerGone()
    }

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
        if (releaseId) clearTimeout(releaseId)
        entry.detach?.()
        if (stalled === entry) {
          console.log(
            `[Proxy][Queue] "${entry.label}" finally stopped; accepting requests again`
          )
          stalled = null
          stalledSince = 0
        }
        if (orphaned.delete(entry)) {
          console.log(
            `[Proxy][Queue] The abandoned task "${entry.label}" stopped after ${Date.now() - startedAt}ms; its slot had already been released`
          )
        }
        console.log(
          `[Proxy][Queue] Finished "${entry.label}" in ${Date.now() - startedAt}ms`
        )
        if (running === entry) {
          running = null
          setTimeout(processQueue, 100)
        }
      })
  }

  const submit = <T>(
    task: (signal: AbortSignal) => Promise<T>,
    {
      timeoutMs = defaultTimeoutMs,
      label = "task",
      signal
    }: RequestQueueOptions = {}
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (stalled) {
        reject(new QueueStalledError(stalled.label))
        return
      }
      if (signal?.aborted) {
        reject(new ClientClosedError(label))
        return
      }
      const entry: QueueEntry = {
        task: task as (signal: AbortSignal) => Promise<unknown>,
        timeoutMs,
        label,
        queuedAt: Date.now(),
        ...(signal ? { signal } : {}),
        resolve: resolve as (value: unknown) => void,
        reject
      }
      if (signal) {
        /**
         * While queued there is nothing to unwind, so the entry is simply
         * dropped. Once it starts, `processQueue` replaces this listener with
         * the running-stage one.
         */
        const onCallerGone = () => {
          const index = queue.indexOf(entry)
          if (index < 0) return
          queue.splice(index, 1)
          entry.detach?.()
          console.log(
            `[Proxy][Queue] "${label}" left the queue: its client closed the connection`
          )
          entry.reject(new ClientClosedError(label))
        }
        signal.addEventListener("abort", onCallerGone, { once: true })
        entry.detach = () => signal.removeEventListener("abort", onCallerGone)
      }
      queue.push(entry)
      if (queue.length > 1) {
        console.log(
          `[Proxy][Queue] "${label}" queued behind ${queue.length - 1} pending request(s)`
        )
      }
      processQueue()
    })

  const inspect = (): QueueInspection => ({
    running: running !== null,
    runningLabel: running?.label ?? null,
    runningForMs: running ? Date.now() - runningSince : null,
    depth: queue.length,
    stalled: stalled !== null,
    stalledLabel: stalled?.label ?? null,
    stalledForMs: stalled ? Date.now() - stalledSince : null,
    orphaned: orphaned.size,
    lastFailure: lastFailure
      ? {
          label: lastFailure.label,
          reason: lastFailure.reason,
          agoMs: Date.now() - lastFailure.at
        }
      : null
  })

  return Object.assign(submit, { inspect })
}
