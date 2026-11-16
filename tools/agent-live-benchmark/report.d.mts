export interface BaselineInputs {
  candidateSha: string
  dirty: boolean
  artifactHash?: string
  corpusVersion: string
  corpusHash: string
  provider: string
  model: string
  reasoningEffort: string
  visionMode: string
  budgets: Record<string, unknown>
  policy: Record<string, unknown>
  /** Approval policy, agent context window and receipt availability. */
  runtime?: Record<string, unknown>
  policySourceHash: string
}
export type BaselineVerdict =
  | "achieved"
  | "false_completion"
  | "partial"
  | "safely_handed_off"
  | "unresolved_effect"
  | "admission_failure"
  | "provider_failure"
  | "infrastructure_failure"
  | "site_blockage"
  | "reported_failure"
  | "pending_adjudication"
export type FailureOrigin =
  | "admission"
  | "plan"
  | "action"
  | "verification"
  | "report"
  | "infrastructure"
export interface BaselineAttempt {
  verdict: BaselineVerdict
  failureOrigin?: FailureOrigin
  success?: boolean
  errorCode?: string
  pauseReason?: string
  failureCode?: string
  /** Stated requirements the task's predicate does not check. */
  unscoredRequirements?: string[]
  /** Refusals by stable code; see run-trace.mjs. */
  refusals?: RefusalHistogram
  receipts?: "available" | "unavailable" | "unobserved"
  prematureCommits?: number
  /** Every refusal against the oracle; see gate-ledger.mjs. */
  gates?: GateLedger
  /** Why an attempt that did not settle stopped; `STOP_CAUSES`. */
  stopCause?: string
  /** The gate, when the stop cause is one. */
  stopGate?: string
}
export interface GateLedger {
  traced: boolean
  steps: number
  refusals: {
    kind: "completion" | "command"
    gate: string
    reason?: string
    step: number
    afterChange: boolean
    label?: "false" | "justified" | "unknown"
    outcome?:
      | "achieved_run"
      | "page_correct_run_not_achieved"
      | "page_wrong_run"
      | "page_unjudged"
  }[]
  budgets: { code: string; gate?: string; step: number }[]
  terminal?: { gate: string; reason?: string; exhausted: string[] }
  streaks: Record<string, number>
}
export interface GateTableRow {
  refusals: number
  false: number
  justified: number
  unknown: number
  achieved_run: number
  page_correct_run_not_achieved: number
  page_wrong_run: number
  page_unjudged: number
  terminal: number
  budgetExhausted: number
  longestStreak: number
}
export interface RefusalHistogram {
  traced: boolean
  completion: Record<string, number>
  resolution: Record<string, number>
  rejectedSteps?: { completion: number; resolution: number }
}
export interface BaselineSummary {
  falseCompletions: number
  goalsAttained: number
  successClaims: number
  voidAttempts: number
  pendingAdjudication: number
  endToEnd: { denominator: number; outcomes: Record<string, number> }
  infrastructureQualified: {
    denominator: number
    outcomes: Record<string, number>
  }
  fulfilledButUnsettled: number
  fulfilledButUnsettledCoverage: {
    requirementsScored: number
    requirementUnscored: number
    coverageUnrecorded: number
  }
  refusals: {
    attemptsRefused: number
    untraced: number
    completion: Record<string, number>
    resolution: Record<string, number>
  }
  gates: {
    tracedAttempts: number
    untracedAttempts: number
    table: Record<string, GateTableRow>
    budgets: Record<string, number>
  }
  stopCauses: { cause: string; gate?: string; count: number }[]
  receipts: Partial<Record<"available" | "unavailable" | "unobserved", number>>
  prematureCommits: { applicable: number; attempts: number; commits: number }
  rankedFailures: { failure: string; count: number }[]
  failureOrigins: Partial<Record<FailureOrigin, number>>
}
export function hashFiles(paths: string[]): string
export function baselineInputs(input: {
  buildDirectory?: string
  corpusFiles: string[]
  provider: string
  model: string
  reasoningEffort?: string
  visionMode: string
  budgets: Record<string, unknown>
  policy: Record<string, unknown>
  runtime?: Record<string, unknown>
}): BaselineInputs
export function successClaim(input: {
  status: string
  answer?: string
}): "claimed" | "not_claimed" | "unsure"
export function failureOrigin(input: {
  verdict: BaselineVerdict
  status?: string
  errorCode?: string
}): FailureOrigin | undefined
export function classifyAttempt(input: {
  status: string
  success?: boolean
  answer?: string
  expectedStatus?: string
  expectedPause?: boolean
  pauseReason?: string
  errorCode?: string
  infrastructureFailure?: boolean
  providerFailure?: boolean
  siteBlocked?: boolean
  admissionFailure?: boolean
  unclearOracle?: boolean
  /** The answer failed only for calling its own result unchecked. */
  hedgedOnly?: boolean
}): BaselineVerdict
export function summarizeBaseline(attempts: BaselineAttempt[]): BaselineSummary
export function renderBaseline(report: {
  inputs: BaselineInputs
  summary: BaselineSummary
  attempts?: BaselineAttempt[]
}): string
export function renderConsoleSummary(
  report: {
    inputs: BaselineInputs
    summary: BaselineSummary
    attempts: BaselineAttempt[]
  },
  directory: string
): string
