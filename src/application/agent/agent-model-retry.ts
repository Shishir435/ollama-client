import {
  AGENT_DECISION_TIMEOUT_MS,
  type AgentCancellationSignal,
  remainingAgentActiveBudgetMs
} from "@ollama-client/agent-runtime"
import type { AgentRunState } from "@ollama-client/contracts"
import { isRetryableProviderStatus } from "@ollama-client/runtime-core/retry"
import { isAbortError } from "@/lib/error-utils"
import { AgentDecisionFormatError } from "./agent-decision-parser"
import { AgentModelCompatibilityError } from "./agent-model-compatibility"

/** A closed vocabulary; provider prose is never used to decide whether to retry. */
export type AgentModelFailureKind =
  | "malformed"
  | "refusal"
  | "capability"
  | "authentication"
  | "configuration"
  | "rate_limit"
  | "service"
  | "transport"
  | "cancelled"
  | "unknown"

type ProviderFailure = {
  code?: unknown
  kind?: unknown
  status?: unknown
  retryable?: unknown
  retryAfterMs?: unknown
}

/** Permanent diagnoses take precedence over a provider's generic retryable flag. */
export const classifyAgentModelFailure = (
  error: unknown
): AgentModelFailureKind => {
  if (error instanceof AgentDecisionFormatError) return "malformed"
  if (error instanceof AgentModelCompatibilityError) return "capability"
  if (isAbortError(error)) return "cancelled"
  if (typeof error !== "object" || error === null) return "unknown"
  const failure = error as ProviderFailure
  if (failure.kind === "abort") return "cancelled"
  if (failure.code === "OLC-MODEL-REFUSED") return "refusal"
  if (
    failure.status === 401 ||
    failure.status === 403 ||
    failure.code === "OLC-AUTH-FAILED" ||
    failure.code === "OLC-CORS-BLOCKED"
  )
    return "authentication"
  if (failure.code === "OLC-INPUT-UNSUPPORTED") return "capability"
  if (
    failure.kind === "validation" ||
    [
      "OLC-PROVIDER-DISABLED",
      "OLC-PAYMENT-REQUIRED",
      "OLC-CONTEXT-TOO-LARGE",
      "OLC-OUT-OF-MEMORY",
      "OLC-MODEL-NOT-FOUND",
      "OLC-MODEL-NOT-LOADED",
      "OLC-RESOURCE-NOT-FOUND"
    ].includes(String(failure.code))
  )
    return "configuration"
  if (failure.status === 429 || failure.code === "OLC-RATE-LIMITED")
    return "rate_limit"
  if (typeof failure.status === "number" && failure.status >= 400) {
    return isRetryableProviderStatus(failure.status)
      ? "service"
      : "configuration"
  }
  if (
    failure.kind === "network" ||
    failure.code === "OLC-PROVIDER-UNREACHABLE" ||
    failure.code === "OLC-STREAM-DROPPED"
  )
    return "transport"
  if (failure.kind === "provider" && failure.retryable === true)
    return "service"
  return "unknown"
}

const MAX_PROVIDER_RETRIES = 2
const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 5_000

/** Only typed transient failures are eligible; raw errors are left to their owner. */
const providerRetryDelay = (
  error: unknown,
  retries: number
): number | undefined => {
  const kind = classifyAgentModelFailure(error)
  if (
    !(
      ["rate_limit", "service", "transport"] as AgentModelFailureKind[]
    ).includes(kind)
  )
    return undefined
  const failure = error as ProviderFailure
  if (failure.retryable === false || retries >= MAX_PROVIDER_RETRIES)
    return undefined
  const guidance = failure.retryAfterMs
  return Math.max(
    Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** retries),
    typeof guidance === "number" && Number.isFinite(guidance) && guidance >= 0
      ? guidance
      : 0
  )
}

const cancelled = () =>
  Object.assign(new Error("Agent model request cancelled"), {
    name: "AbortError"
  })

/** The timer and its abort listener both end with this inference owner. */
const waitForProvider = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      reject(cancelled())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, delayMs)
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })

/**
 * Retries inference only, on the same configured provider and immutable inputs.
 * Format retries and transport retries have separate counters and share one
 * deadline across all attempts. No effect, persistence or fallback port exists here.
 */
export const runAgentModelRequest = async <T>(input: {
  state: AgentRunState
  signal: AgentCancellationSignal
  malformedRetries: number
  onMalformed?: (error: AgentDecisionFormatError) => boolean
  measured?: (telemetry: {
    providerRetries: number
    providerBackoffMs: number
  }) => void
  request: (
    signal: AbortSignal,
    feedback: AgentDecisionFormatError | undefined,
    retry: number
  ) => Promise<T>
}): Promise<T> => {
  const scope = new AbortController()
  const abort = () => scope.abort()
  if (input.signal.aborted) abort()
  else input.signal.addEventListener?.("abort", abort, { once: true })
  const startedAt = Date.now()
  const available = Math.min(
    AGENT_DECISION_TIMEOUT_MS,
    input.state.deadline
      ? remainingAgentActiveBudgetMs(input.state.deadline, startedAt)
      : AGENT_DECISION_TIMEOUT_MS
  )
  const deadline = startedAt + available
  const timer = setTimeout(abort, available)
  let providerRetries = 0
  let providerBackoffMs = 0
  let malformedRetries = 0
  let feedback: AgentDecisionFormatError | undefined
  const assertActive = () => {
    if (scope.signal.aborted || input.signal.aborted || Date.now() >= deadline)
      throw cancelled()
  }
  const recover = async (error: unknown): Promise<void> => {
    if (scope.signal.aborted || input.signal.aborted) throw error
    if (error instanceof AgentDecisionFormatError) {
      const allowed = input.onMalformed?.(error) ?? true
      if (!allowed || malformedRetries >= input.malformedRetries) throw error
      feedback = error
      malformedRetries += 1
      return
    }
    const delay = providerRetryDelay(error, providerRetries)
    /** Never shorten Retry-After to fit; leave the provider's actionable error intact. */
    if (delay === undefined || delay >= deadline - Date.now()) throw error
    const waitStartedAt = Date.now()
    try {
      await waitForProvider(delay, scope.signal)
    } finally {
      providerBackoffMs += Date.now() - waitStartedAt
    }
    assertActive()
    providerRetries += 1
  }
  try {
    while (true) {
      assertActive()
      try {
        const result = await input.request(
          scope.signal,
          feedback,
          malformedRetries
        )
        assertActive()
        return result
      } catch (error) {
        await recover(error)
      }
    }
  } finally {
    clearTimeout(timer)
    abort()
    input.signal.removeEventListener?.("abort", abort)
    input.measured?.({ providerRetries, providerBackoffMs })
  }
}
