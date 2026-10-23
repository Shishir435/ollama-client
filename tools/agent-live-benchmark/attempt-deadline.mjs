import { SETTLED_RUN_STATUSES } from "./chat-turn.mjs"

/** Allow the product's forty-minute active budget to settle before the harness stops it. */
export const taskTimeoutFromEnv = (env = process.env) => {
  const raw = env.AUDIT_TASK_TIMEOUT_MS
  if (raw === undefined) return 45 * 60_000
  const value = Number(raw)
  if (!String(raw).trim() || !Number.isSafeInteger(value) || value <= 0)
    throw new Error("AUDIT_TASK_TIMEOUT_MS takes a positive integer")
  return value
}

/** A harness deadline voids an unfinished run as well as a missing answer. */
export const attemptTimedOut = ({ status, deadlineReached = false }) =>
  status === "harness_timeout" ||
  (deadlineReached &&
    !["answered_in_chat", "paused", "awaiting_takeover"].includes(status) &&
    !SETTLED_RUN_STATUSES.includes(status))

/** Bounds on the harness's own work around an attempt, apart from the task's. */
export const SETUP_TIMEOUT_MS = 2 * 60_000
export const TEARDOWN_TIMEOUT_MS = 60_000

/** Raised when setup or teardown outlives its bound; the attempt is infrastructure. */
export class HarnessDeadlineError extends Error {
  constructor(phase, label, ms) {
    super(`${phase} step "${label}" did not finish within ${ms}ms`)
    this.name = "HarnessDeadlineError"
    this.failureCode = `harness_${phase}_timeout`
  }
}

/**
 * Rejects with a `HarnessDeadlineError` when `work` has not settled in `ms`.
 * The work itself is not cancelled — a hung browser call cannot be — only
 * waited on no longer, which is what lets the suite move to its next task
 * instead of stalling behind one hung page.
 */
export const withDeadline = (phase, label, ms, work) => {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new HarnessDeadlineError(phase, label, ms)),
      ms
    )
  })
  return Promise.race([Promise.resolve().then(work), deadline]).finally(() =>
    clearTimeout(timer)
  )
}

/** Run teardown work bounded and never fatal: a hung close must not stop the suite. */
export const settleTeardown = (label, work, ms = TEARDOWN_TIMEOUT_MS) =>
  withDeadline("teardown", label, ms, work).catch((error) => {
    console.warn(`[benchmark] ${error.message}`)
  })

/** Statuses by which a provider refuses to serve, as opposed to failing to. */
const REFUSAL_STATUSES = [401, 403, 407]
/** How long a rate limit may go unanswered before it is read as a refusal. */
export const RATE_LIMIT_PATIENCE_MS = 3 * 60_000

/**
 * Whether the provider has refused this attempt before making any decision:
 * every chat request so far was answered with a refusal, none with success.
 * Authentication and host refusals are final at once; a rate limit only
 * after `RATE_LIMIT_PATIENCE_MS`, since the agent's own retry may clear it.
 * Harness-injected answers are the harness's faults, never the provider's.
 */
export const providerRefusal = (wire, now = Date.now()) => {
  const chats = wire.filter(
    (record) => record.path?.endsWith("/chat/completions") && !record.injected
  )
  const answered = chats.filter((record) => record.status !== undefined)
  if (!answered.length || answered.some((record) => record.status < 400))
    return undefined
  if (answered.some((record) => REFUSAL_STATUSES.includes(record.status)))
    return "provider_refused"
  const limited = answered.filter((record) => record.status === 429)
  if (
    limited.length === answered.length &&
    now - Math.min(...limited.map((record) => record.started ?? now)) >=
      RATE_LIMIT_PATIENCE_MS
  )
    return "provider_rate_limited"
  return undefined
}
