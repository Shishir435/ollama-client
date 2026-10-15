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
