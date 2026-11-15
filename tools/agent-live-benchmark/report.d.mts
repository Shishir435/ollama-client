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
