import { type PersistenceOp, RETRYABLE_OPS } from "./protocol"

/**
 * Why a persistence call failed, in the only terms a caller can act on.
 *
 * The distinction that matters is not *what* broke but *whether the statement
 * ran*. A request that was never handed over can be repeated freely; one that
 * timed out mid-flight has an unknown commit outcome and repeating it can
 * double a write.
 */
export type PersistenceFailureReason =
  /** Refused before a byte was sent — the owner could not be brought up. */
  | "not-delivered"
  /** Sent and never answered. The statement may or may not have committed. */
  | "timeout"
  /** The owner ran it and reported a failure. */
  | "owner-error"
  /** The owner answered something this version cannot parse. */
  | "invalid-response"

const SAFE_TEXT: Record<PersistenceFailureReason, string> = {
  "not-delivered": "Local storage was unavailable, so nothing was saved.",
  timeout: "Local storage did not respond in time.",
  "owner-error": "Local storage rejected the change.",
  "invalid-response": "Local storage returned an unexpected response."
}

export interface PersistenceErrorOptions {
  /** The persistence op, e.g. `run`, `query`, `importDb`. */
  op: PersistenceOp["op"]
  reason: PersistenceFailureReason
  /**
   * Owner-supplied text, for diagnostics only.
   *
   * Kept out of `message` deliberately. The owner forwards whatever SQLite
   * said, and that can name tables, columns and statement fragments; a bare
   * `new Error(ownerText)` put all of it into the string that generic logging
   * and error bubbles print. Bound parameters — where chat, page and file
   * content live — are not echoed by SQLite, but "not currently echoed" is not
   * a property to build a disclosure boundary on.
   */
  detail?: string
  cause?: unknown
}

/**
 * A failure crossing the persistence RPC boundary, carrying enough to decide
 * what to do about it and nothing that would leak what was being stored.
 */
export class PersistenceError extends Error {
  readonly op: PersistenceOp["op"]
  readonly reason: PersistenceFailureReason
  /** Safe fallback text. Contains no SQL, no identifiers, no stored content. */
  readonly userMessage: string
  /** @see PersistenceErrorOptions.detail */
  readonly detail?: string

  constructor(options: PersistenceErrorOptions) {
    super(`Persistence "${options.op}" failed: ${options.reason}`)
    this.name = "PersistenceError"
    this.op = options.op
    this.reason = options.reason
    this.userMessage = SAFE_TEXT[options.reason]
    this.detail = options.detail
    if (options.cause !== undefined) this.cause = options.cause
  }

  /**
   * Whether repeating this call is safe.
   *
   * True when the request provably never executed, or when the op is
   * idempotent by construction and can therefore absorb an unknown outcome.
   * This is the same rule the client applies to its own single retry, exposed
   * so a caller above can make the same decision without re-deriving it.
   */
  get retryable(): boolean {
    return this.reason === "not-delivered" || RETRYABLE_OPS.has(this.op)
  }
}

/**
 * A request that provably never reached the owner.
 *
 * The distinction matters for retries: an operation that failed while the
 * owner was being brought up did not execute, so repeating it cannot double a
 * write. An operation that failed after it was handed over has an unknown
 * commit outcome and is only retried when it is idempotent by construction.
 */
export class PersistenceNotDeliveredError extends PersistenceError {
  constructor(op: PersistenceOp["op"], cause: unknown) {
    super({
      op,
      reason: "not-delivered",
      detail: cause instanceof Error ? cause.message : String(cause),
      cause
    })
    this.name = "PersistenceNotDeliveredError"
  }
}
