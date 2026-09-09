import type {
  AgentApprovalRequest,
  AgentCommand,
  AgentDecision,
  AgentError,
  AgentGrant,
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
  /**
   * How the step before this decision turned out. Declared since the loop was
   * written and never populated, so every decision was made as if it were the
   * first — the single largest cause of a run repeating an action it had
   * already completed.
   */
  previousVerification?: AgentVerificationResult
  /** Bounded, oldest-first record of what this run has already done. */
  history?: readonly AgentHistoryEntry[]
}

export interface AgentObserveRequest {
  runId: string
  tabId: number
  minimumGeneration: number
  /**
   * The origins the run may read. A child frame on any other origin is listed
   * in the observation as unauthorized and contributes nothing, so the check
   * happens where frames are read rather than after their content arrived.
   */
  allowedOrigins: readonly string[]
}

export interface ResolvedAgentTarget {
  ref?: string
  verificationId?: string
  /** The frame the observed element lives in; the root frame is 0. */
  frameId?: number
  /**
   * The identity the element's own frame holds. The command names the root
   * snapshot; the executor binds the effect to this one, because a child frame
   * keeps its own references and its own generation.
   */
  frame?: AgentSnapshotIdentity
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
    /** Covered by a grant the user gave earlier in this run, for this origin. */
    | {
        type: "grant"
        risk: AgentRisk
        origin: string
        authorizedAt: number
      }
}

export interface AgentExecutionReceipt {
  /** Ephemeral exact native submission destination. Contains form values; never persist or log. */
  submissionUrl?: string
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
  /** What the verifier's own observation may read; see `AgentObserveRequest`. */
  allowedOrigins: readonly string[]
}

export type AgentPolicyBlockReason =
  | "unsupported_scheme"
  | "private_data_egress"
  | "unsupported_effect"

export type AgentPolicyDecision =
  | { type: "allow"; risk: AgentRisk }
  /** Allowed only because a grant covers it, which the receipt records. */
  | { type: "granted"; risk: AgentRisk; origin: string }
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
  /**
   * Tabs the run already drives. Switching to any other tab adopts a page the
   * user has been working in, so it costs an approval whatever the page is.
   */
  scopedTabIds: readonly number[]
  /** What the user pre-authorized for this run, if anything. */
  grants?: readonly AgentGrant[]
  now: number
}

export type AgentApprovalDecision =
  | {
      type: "approved"
      /**
       * `run_origin` widens the approval to the classes the request itself
       * offered, on the origin it named, for the rest of the run. Anything
       * else the request did not offer is ignored: what may be widened is
       * policy's answer, not the panel's.
       */
      scope?: "once" | "run_origin"
    }
  | { type: "rejected" }

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
    | "answers"
    | "deadline"
    | "controlledTabId"
    | "error"
    | "grants"
    | "observationCount"
    | "pauseReason"
    | "question"
    | "result"
    | "scopedTabIds"
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

/**
 * What a step acted on, in terms that survive the next snapshot.
 *
 * A receipt used to hold the command alone, and a command holds a ref — `e1`
 * means nothing once the page has been observed again, so the run could not
 * describe its own history. Role, tag and a bounded name can be recognized
 * later; the name is page text, so it is dropped when the control was
 * sensitive and bounded whether or not it was.
 */
export interface AgentStepTarget {
  ref?: string
  tag?: string
  role?: string
  name?: string
}

export interface AgentStepWrite {
  runId: string
  stepId: string
  status: AgentStepStatus
  at: number
  command?: AgentCommand
  risk?: AgentRisk
  verification?: AgentVerificationResult
  target?: AgentStepTarget
  /** The page the step was taken on, so history can say where it happened. */
  sourceUrl?: string
  /** Model-authored note attached to the step it belongs to. */
  finding?: string
}

/** A step as it is read back, carrying the durable order it was written in. */
export interface AgentStepReadout extends AgentStepWrite {
  sequence: number
}

/**
 * One entry in what the model is told about its own run.
 *
 * `outcome` is deliberately not the step status: a status of `executed` with
 * no verification is not a success, and presenting it as one is how a run
 * concludes it has done something it only attempted.
 */
export interface AgentHistoryEntry {
  step: number
  action: string
  outcome:
    | "confirmed"
    | "unverified"
    | "uncertain"
    | "rejected"
    | "failed"
    | "planned"
  target?: AgentStepTarget
  url?: string
  evidence?: string
  finding?: string
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

/** Trusted executor rejected stale state before any browser effect was attempted. */
export class AgentEffectNotAppliedError extends Error {
  constructor(message = "The observed target changed before execution") {
    super(message)
    this.name = "AgentEffectNotAppliedError"
  }
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
  /**
   * The run's own receipts, in the order they were written. History is built
   * from these rather than from anything the controller holds in memory,
   * because a worker restart keeps the receipts and loses the memory.
   */
  steps(runId: string): Promise<readonly AgentStepReadout[]>
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
  requestPause(runId: string, reason?: AgentPauseReason): Promise<void>
  resume(runId: string): Promise<void>
  requestCancel(runId: string): Promise<void>
  completeTakeover(runId: string): Promise<void>
  /**
   * Records the user's answer to the run's open question and resumes it. The
   * question id is named so a click on a stale panel cannot answer whatever
   * question replaced the one it showed.
   */
  answerQuestion(input: {
    runId: string
    questionId: string
    text: string
  }): Promise<void>
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
  /**
   * Structural metadata only, for a host that wants to see why a run
   * degraded. Never page text, arguments or URLs — the same rule the
   * background's own trace already holds itself to.
   */
  trace?: (
    runId: string,
    phase: string,
    metadata?: Record<string, string | number | boolean | undefined>
  ) => void
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
