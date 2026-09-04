import type {
  AgentApprovalRequest,
  AgentCommand,
  AgentDecision,
  AgentError,
  AgentObservation,
  AgentPauseReason,
  AgentRunState,
  AgentRunStatus,
  AgentSnapshotIdentity,
  AgentStepStatus,
  AgentTakeoverRequest
} from "@ollama-client/contracts"

export type AgentRisk = "low" | "medium" | "high" | "critical"

export interface AgentModelInput {
  state: AgentRunState
  observation: AgentObservation
  previousVerification?: AgentVerificationResult
}

export interface AgentObserveRequest {
  runId: string
  tabId: number
  minimumGeneration: number
}

export interface ResolvedAgentTarget {
  ref?: string
  verificationId?: string
  frameId?: 0
  tag?: string
  role?: string
  accessibleName?: string
  inputType?: string
  observedValue?: string
  observedChecked?: boolean
  observedFocused?: boolean
  href?: string
  formAction?: string
  formMethod?: "get" | "post" | "dialog"
  formFingerprint?: string
  formHasSensitiveControl?: boolean
  submitter?: boolean
  expectedValue?: string
  expectedChecked?: boolean
  sensitive: boolean
  maySubmit: boolean
}

export interface AgentDestination {
  url: string
  origin: string
  source: "observed" | "model" | "browser"
  /**
   * Set by the resolver when the destination carries data the run only knows
   * because it observed the page: `field_value` for something a user typed
   * into a control, `visible_text` for rendered page text. Evidence, not a
   * decision — policy owns what each grade costs.
   */
  pageDataEvidence?: "field_value" | "visible_text"
}

export type AgentSemanticEffect =
  | "read"
  | "scroll"
  | "navigation"
  | "activation"
  | "form_mutation"
  | "submission"
  | "destructive"
  | "download"
  | "authentication"
  | "payment"
  | "sensitive_input"

export interface ResolvedAgentEffect {
  command: AgentCommand
  target: ResolvedAgentTarget
  destination?: AgentDestination
  semanticEffects: readonly AgentSemanticEffect[]
  snapshotIdentity: AgentSnapshotIdentity
  sourceUrl: string
  sourceOrigin: string
}

export interface AuthorizedAgentEffect extends ResolvedAgentEffect {
  authorization:
    | { type: "policy"; risk: AgentRisk; authorizedAt: number }
    | {
        type: "approval"
        risk: AgentRisk
        approvalId: string
        authorizedAt: number
      }
}

export interface AgentExecutionReceipt {
  executedAt: number
  details?: string
  controlledTabId?: number
}

export interface AgentVerificationEvidence {
  kind: string
  summary: string
  observedAt: number
}

export type AgentVerificationResult =
  | { outcome: "confirmed"; evidence: AgentVerificationEvidence }
  | { outcome: "negative"; evidence: AgentVerificationEvidence }
  | { outcome: "ambiguous"; evidence: AgentVerificationEvidence }

export interface AgentVerificationInput {
  effect: AuthorizedAgentEffect
  receipt: AgentExecutionReceipt
  before: AgentObservation
}

export type AgentPolicyBlockReason =
  | "unsupported_scheme"
  | "private_data_egress"
  | "unsupported_effect"

export type AgentPolicyDecision =
  | { type: "allow"; risk: AgentRisk }
  | {
      type: "approval_required"
      risk: AgentRisk
      request: AgentApprovalRequest
    }
  | {
      type: "takeover_required"
      risk: AgentRisk
      request: AgentTakeoverRequest
    }
  | { type: "blocked"; risk: AgentRisk; reason: AgentPolicyBlockReason }

export interface AgentPolicyInput {
  runId: string
  stepId: string
  effect: ResolvedAgentEffect
  allowedOrigins: readonly string[]
  now: number
}

export type AgentApprovalDecision = { type: "approved" } | { type: "rejected" }

export type AgentTakeoverDecision =
  | { type: "takeover_started" }
  | { type: "cancelled" }

export interface AgentPhaseClaim {
  runId: string
  phase: AgentRunStatus
  expected: readonly AgentRunStatus[]
  patch?: AgentStatePatch
}

export type AgentClaimResult =
  | { claimed: true; state: AgentRunState }
  | { claimed: false; state?: AgentRunState }

export type AgentStatePatch = Partial<
  Pick<
    AgentRunState,
    | "allowedOrigins"
    | "deadline"
    | "controlledTabId"
    | "error"
    | "observationCount"
    | "pauseReason"
    | "stepCount"
    | "updatedAt"
  >
>

export interface AgentTransitionWrite {
  runId: string
  from: AgentRunStatus
  to: AgentRunStatus
  patch?: AgentStatePatch
}

export type AgentTransitionResult =
  | { transitioned: true; state: AgentRunState }
  | { transitioned: false; state?: AgentRunState }

export interface AgentStepWrite {
  runId: string
  stepId: string
  status: AgentStepStatus
  at: number
  command?: AgentCommand
  risk?: AgentRisk
  verification?: AgentVerificationResult
}

/** Environment-neutral subset implemented by a host AbortSignal. */
export interface AgentCancellationSignal {
  readonly aborted: boolean
  addEventListener?(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean }
  ): void
  removeEventListener?(type: "abort", listener: () => void): void
}

/** Environment-neutral subset implemented by a host AbortController. */
export interface AgentCancellationController {
  readonly signal: AgentCancellationSignal
  abort(): void
}

/** A provider responded, but its output was not a valid Agent decision. */
export class AgentMalformedDecisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgentMalformedDecisionError"
  }
}

export interface AgentModelPort {
  decide(
    input: AgentModelInput,
    signal: AgentCancellationSignal
  ): Promise<AgentDecision>
}

export interface AgentObservationPort {
  observe(
    request: AgentObserveRequest,
    signal: AgentCancellationSignal
  ): Promise<AgentObservation>
}

export interface AgentEffectPort {
  resolve(
    command: AgentCommand,
    observation: AgentObservation
  ): Promise<ResolvedAgentEffect>
  execute(
    effect: AuthorizedAgentEffect,
    signal: AgentCancellationSignal
  ): Promise<AgentExecutionReceipt>
  verify(
    input: AgentVerificationInput,
    signal: AgentCancellationSignal
  ): Promise<AgentVerificationResult>
}

export interface AgentPolicyPort {
  evaluate(input: AgentPolicyInput): AgentPolicyDecision
}

export interface AgentPersistencePort {
  claim(input: AgentPhaseClaim): Promise<AgentClaimResult>
  appendStep(input: AgentStepWrite): Promise<void>
  transition(input: AgentTransitionWrite): Promise<AgentTransitionResult>
  load(runId: string): Promise<AgentRunState | undefined>
}

export interface AgentApprovalPort {
  request(
    input: AgentApprovalRequest,
    signal: AgentCancellationSignal
  ): Promise<AgentApprovalDecision>
}

export interface AgentTakeoverPort {
  request(
    input: AgentTakeoverRequest,
    signal: AgentCancellationSignal
  ): Promise<AgentTakeoverDecision>
}

export interface AgentClockPort {
  now(): number
}

export interface AgentController {
  start(runId: string): Promise<void>
  requestPause(runId: string): Promise<void>
  resume(runId: string): Promise<void>
  requestCancel(runId: string): Promise<void>
  completeTakeover(runId: string): Promise<void>
}

export interface AgentControllerDependencies {
  model: AgentModelPort
  observation: AgentObservationPort
  effect: AgentEffectPort
  policy: AgentPolicyPort
  persistence: AgentPersistencePort
  approval: AgentApprovalPort
  takeover: AgentTakeoverPort
  clock: AgentClockPort
  createCancellationController?: () => AgentCancellationController
  maxMalformedDecisions?: number
}

export const agentFailure = (
  code: AgentError["code"],
  message: string,
  retryable = false
): AgentError => ({ code, message, retryable })

export const pausePatch = (
  reason: AgentPauseReason,
  updatedAt: number
): AgentStatePatch => ({ pauseReason: reason, updatedAt })
