/** Value coercion and retry helpers shared across the proxy. */
import type { RetryAsync } from "./types.js"

export const parseBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value === 1
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  }
  if (value === undefined || value === null) return fallback
  return Boolean(value)
}

/** Parse a list from an array or a comma/space separated string. */
export const parseList = (
  value: unknown,
  fallback: string[] = []
): string[] => {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim() !== ""
    )
  }
  if (typeof value === "string") {
    const entries = value
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    return entries.length > 0 ? entries : fallback
  }
  return fallback
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

/**
 * Read a system error's `code` without asserting a shape onto it.
 *
 * `NodeJS.ErrnoException` is a claim about a value the runtime handed us, not a
 * fact: an `error` event or a rejected call can carry anything, and asserting
 * the type turns "no code here" into a silent `undefined` comparison that reads
 * as a code that did not match.
 */
export const errorCode = (error: unknown): string | undefined =>
  isRecord(error) && typeof error.code === "string" ? error.code : undefined

/** A local endpoint must not be able to return an unbounded diagnostic body. */
export const readBoundedJson = async (
  response: Response,
  limit = 16384
): Promise<unknown> => {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) return null
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } finally {
    await reader.cancel()
  }
}

export const isRetryableNetworkError = (error: unknown): boolean => {
  if (!error) return false
  const candidate = error as {
    message?: unknown
    code?: unknown
    cause?: { code?: unknown }
  }
  const message = String(candidate.message ?? error).toLowerCase()
  const code = candidate.code ?? candidate.cause?.code
  const retryableCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "ENOTFOUND"
  ])
  if (typeof code === "string" && retryableCodes.has(code)) return true
  return (
    message.includes("socket hang up") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("network") ||
    message.includes("timeout")
  )
}

/** Raised when a bounded await ran out before the operation answered. */
export class OperationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} did not answer within ${timeoutMs}ms`)
    this.name = "OperationTimeoutError"
  }
}

/** Raised when an await was ended by a caller's abort rather than an answer. */
export class OperationAbortedError extends Error {
  constructor(label: string) {
    super(`${label} was cancelled before it answered`)
    this.name = "OperationAbortedError"
  }
}

/**
 * Bound an await that carries no cancellation of its own.
 *
 * Why: an SDK call that never settles holds whatever awaits it for the life of
 * the process, and the queue's single-flight slot is one of those things. The
 * work itself is not cancelled — nothing here can cancel it — but the wait for
 * it is, which is the whole difference between a slow call and a wedged proxy.
 *
 * `Promise.race` keeps a handler attached to the operation, so a rejection that
 * arrives after the deadline is still handled and never surfaces as an
 * unhandled rejection.
 */
export const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number | undefined,
  label = "operation"
): Promise<T> => {
  if (!timeoutMs || timeoutMs <= 0) return await operation
  const expiry = AbortSignal.timeout(timeoutMs)
  return await Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      expiry.addEventListener(
        "abort",
        () => reject(new OperationTimeoutError(label, timeoutMs)),
        { once: true }
      )
    })
  ])
}

/**
 * Stop awaiting as soon as `signal` aborts.
 *
 * An SDK call that accepts a signal may still ignore it, or resolve into an
 * iterator that simply goes quiet. The caller's abort is the fact that matters,
 * so it ends the wait here whatever the callee does with it.
 */
export const untilAborted = async <T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  label = "operation"
): Promise<T> => {
  if (!signal) return await operation
  if (signal.aborted) {
    void operation.catch(() => {})
    throw new OperationAbortedError(label)
  }
  return await Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new OperationAbortedError(label)),
        { once: true }
      )
    })
  ])
}

/** An `AbortSignal` aborted as soon as any of the given signals is. */
export const anySignal = (
  signals: (AbortSignal | undefined)[]
): AbortSignal => {
  const controller = new AbortController()
  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true
    })
  }
  return controller.signal
}

/**
 * How long one attempt of a loopback runtime call may take before the wait is
 * abandoned. Every call this wrapper makes is to a process on this machine, so
 * anything that has not answered by now is not going to.
 */
export const DEFAULT_OPERATION_TIMEOUT_MS = 30_000

/**
 * Retry transport failures only.
 *
 * Why the distinction: a refused or reset connection says nothing happened yet,
 * so repeating it is safe. An error the OpenCode server produced is a real
 * answer, and repeating that request would duplicate whatever it already did.
 *
 * A bounded wait that ran out is the third case and is retried by neither rule:
 * it says nothing about whether the call reached the server, so repeating it
 * could duplicate work that is still in flight. The bound exists so the caller
 * is not held, not so the call is tried again.
 */
export const createRetryAsync = ({
  retries = 3,
  delayMs = 750,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  log = () => {}
}: {
  retries?: number
  delayMs?: number
  /** Per-attempt bound. Zero or undefined leaves an attempt unbounded. */
  timeoutMs?: number
  log?: (message: string) => void
} = {}): RetryAsync => {
  return async function retryAsync<T>(
    operation: () => Promise<T>,
    {
      label = "operation",
      timeoutMs: attemptTimeoutMs = timeoutMs
    }: { label?: string; timeoutMs?: number } = {}
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      try {
        return await withTimeout(operation(), attemptTimeoutMs, label)
      } catch (error) {
        lastError = error
        const isLastAttempt = attempt === retries + 1
        if (error instanceof OperationTimeoutError) throw error
        if (!isRetryableNetworkError(error) || isLastAttempt) throw error
        log(
          `[Proxy][Retry] ${label} failed (attempt ${attempt}/${retries + 1}): ${(error as Error).message}. Retrying in ${delayMs}ms...`
        )
        await sleep(delayMs)
      }
    }
    throw lastError
  }
}
