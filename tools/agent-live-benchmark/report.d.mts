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
export interface BaselineAttempt {
  verdict: BaselineVerdict
  success?: boolean
  errorCode?: string
  pauseReason?: string
  failureCode?: string
}
export interface BaselineSummary {
  endToEnd: { denominator: number; outcomes: Record<string, number> }
  infrastructureQualified: {
    denominator: number
    outcomes: Record<string, number>
  }
  fulfilledButUnsettled: number
  rankedFailures: { failure: string; count: number }[]
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
}): BaselineInputs
export function classifyAttempt(input: {
  status: string
  success?: boolean
  expectedStatus?: string
  pauseReason?: string
  errorCode?: string
  infrastructureFailure?: boolean
  providerFailure?: boolean
  siteBlocked?: boolean
  admissionFailure?: boolean
}): BaselineVerdict
export function summarizeBaseline(attempts: BaselineAttempt[]): BaselineSummary
export function renderBaseline(report: {
  inputs: BaselineInputs
  summary: BaselineSummary
}): string
