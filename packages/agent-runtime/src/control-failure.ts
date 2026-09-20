/**
 * Why a bound control request could not be answered.
 *
 * A content script that cannot answer used to close the port, which reached
 * the run as "the page could not be observed safely" with nothing behind it:
 * a decorative icon that failed the observation contract and a document that
 * genuinely cannot be read were the same sentence. These reasons name the
 * stage that failed instead, and travel with structural schema evidence only.
 */
export const AGENT_CONTROL_FAILURE_REASONS = [
  "observation_build_failed",
  "observation_invalid",
  "execution_failed"
] as const
export type AgentControlFailureReason =
  (typeof AGENT_CONTROL_FAILURE_REASONS)[number]

/**
 * A schema rejection reduced to what is safe to keep: where in the shape the
 * rejection happened and which rule rejected it. The rejected value itself is
 * page content, and a diagnostic is not a place to put page content.
 */
export interface AgentSchemaIssue {
  path: string
  code: string
}

export class AgentControlFailedError extends Error {
  readonly reason: AgentControlFailureReason
  readonly issues: readonly AgentSchemaIssue[]

  constructor(input: {
    reason: AgentControlFailureReason
    issues?: readonly AgentSchemaIssue[]
  }) {
    super(input.reason)
    this.name = "AgentControlFailedError"
    this.reason = input.reason
    this.issues = input.issues ?? []
  }
}

const UNQUALIFIED_OBSERVATION_FAILURE =
  "The current page could not be observed safely."

const OBSERVATION_FAILURE_MESSAGES: Partial<
  Record<AgentControlFailureReason, string>
> = {
  observation_build_failed: "The current page could not be read.",
  observation_invalid:
    "The page produced a snapshot that failed the observation contract."
}

/**
 * The run-visible sentence for an observation that did not arrive. A reason
 * this stage does not answer for — and anything untyped — keeps the original
 * wording, because an unrecognized failure is exactly the case where a more
 * specific claim would be invented.
 */
export const agentObservationFailureMessage = (error: unknown): string =>
  (error instanceof AgentControlFailedError
    ? OBSERVATION_FAILURE_MESSAGES[error.reason]
    : undefined) ?? UNQUALIFIED_OBSERVATION_FAILURE
