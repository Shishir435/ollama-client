import type {
  AgentApprovalRequest,
  AgentCommand,
  AgentDecision,
  AgentDialogState,
  AgentError,
  AgentGrant,
  AgentImageRect,
  AgentObservation,
  AgentPauseReason,
  AgentRunState,
  AgentRunStatus,
  AgentScreenshot,
  AgentSnapshotIdentity,
  AgentStepStatus,
  AgentTakeoverRequest
} from "@ollama-client/contracts"

export type AgentRisk = "low" | "medium" | "high" | "critical"

/**
 * What the model asked to see more of on its previous step, derived from that
 * step's own command so a worker restart rebuilds it. The projection expands
 * exactly one of these against the fresh observation: a region by its group, a
 * query's matching controls, or the whole document's text.
 */
export interface AgentInspectionFocus {
  region?: string
  query?: string
  text?: boolean
  offset?: number
  frameId?: number
  /**
   * A region of the previous screenshot, in that image's pixels, that the next
   * screenshot should magnify. Converted by the capture port, which alone
   * remembers the previous image's geometry; after a restart it is ignored
   * and the whole viewport is captured.
   */
  zoom?: AgentImageRect
}

/**
 * A fact the run recorded on some earlier step and still needs. The note is
 * the model's own words, kept beyond the history window so a long run does
 * not forget what it learned; `source` is the page it was recorded on, so a
 * claim can be told from the site that made it. It is page-derived and stays
 * untrusted — a note cannot change the goal or the policy any more than the
 * page it came from could.
 */
export interface AgentFinding {
  step: number
  note: string
  source?: string
}

export interface AgentModelInput {
  state: AgentRunState
  observation: AgentObservation
  /**
   * The inspection the previous step requested, if it was one. Steers this
   * step's overview so an inspected region, a found control, or extracted text
   * is present rather than summarised again.
   */
  inspection?: AgentInspectionFocus
  /**
   * The run's recorded findings, oldest first, kept past the history window so
   * a fact learned early survives a long run. Page-derived and untrusted.
   */
  findings?: readonly AgentFinding[]
  /**
   * How the step before this decision turned out. Declared since the loop was
   * written and never populated, so every decision was made as if it were the
   * first — the single largest cause of a run repeating an action it had
   * already completed.
   */
  previousVerification?: AgentVerificationResult
  /** Bounded, oldest-first record of what this run has already done. */
  history?: readonly AgentHistoryEntry[]
  /**
   * The viewport as pictured with this observation, for a model that can see.
   * Absent for a text-only model, when the run holds no way to capture, or
   * when the page could not be pictured without exposing a sensitive control.
   */
  screenshot?: AgentScreenshot
}

export interface AgentScreenshotRequest {
  runId: string
  tabId: number
  /** The observation the picture belongs to; the capture binds itself to it. */
  observation: AgentObservation
  /** What the previous step asked to magnify, if it asked. */
  zoom?: AgentImageRect
}

/**
 * Pictures the controlled tab for one decision. `undefined` is an answer, not
 * a failure: a run without a capture path, or a page whose sensitive controls
 * could not be masked, decides from the DOM observation alone. The picture is
 * held for the decision and the resolution that follows and nowhere else.
 */
export interface AgentScreenshotPort {
  capture(
    request: AgentScreenshotRequest,
    signal: AgentCancellationSignal
  ): Promise<AgentScreenshot | undefined>
}

export interface AgentObserveRequest {
  extraction?: { offset: number; frameId: number }
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
  /**
   * The CSS point a visual click named, in the root layout viewport. The
   * executor aims there rather than at the control's centre, and the page
   * confirms the control is still what lies under it before anything is sent.
   */
  point?: { x: number; y: number }
  /**
   * Where a drag ends: the observed element the pointer is released over,
   * grounded like the source so a drop is an effect on a control the run
   * named, and re-checked before the pointer moves.
   */
  drop?: AgentDropTarget
  sensitive: boolean
  maySubmit: boolean
  /**
   * Set on an edit whose target has no submission step: an editing host, or a
   * field belonging to no form. It says what the observation can prove — that
   * no later submit exists for the user to be asked about — and nothing about
   * whether the page stored anything, which only the page knows. Evidence,
   * not a decision: policy words the approval with it.
   */
  noSubmitStep?: boolean
}

/** The destination of a drag, in the terms its later recheck compares. */
export interface AgentDropTarget {
  ref: string
  verificationId?: string
  frameId: number
  tag: string
  role?: string
  accessibleName?: string
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
  /** A pointer arriving on a control and staying there; nothing is pressed. */
  | "hover"
  | "navigation"
  | "activation"
  | "form_mutation"
  /** A pointer picks a control up and releases it over another. */
  | "drag"
  /** Answering a native dialog the page opened; dismissing one included. */
  | "dialog"
  | "submission"
  | "destructive"
  | "download"
  | "authentication"
  | "payment"
  | "sensitive_input"
  /** Opening the browser's file chooser, which only the user can answer. */
  | "file_selection"

export interface ResolvedAgentEffect {
  command: AgentCommand
  target: ResolvedAgentTarget
  destination?: AgentDestination
  /**
   * The native dialog this effect answers, for the one command that answers
   * one. Its identity travels so the executor can refuse an answer aimed at a
   * prompt that has since been replaced, and its kind travels so policy and
   * the panel can say what is being accepted rather than naming a command.
   */
  dialog?: Pick<AgentDialogState, "id" | "type">
  semanticEffects: readonly AgentSemanticEffect[]
  snapshotIdentity: AgentSnapshotIdentity
  /** The page the run is on: what the tab shows and what history records. */
  sourceUrl: string
  sourceOrigin: string
  /**
   * Where the effect actually happens when the target is in a child frame.
   * Policy judges grants and sensitive paths against this, not the page: a
   * grant for the page's origin says nothing about a frame from another site
   * embedded in it, and a sign-in form inside a frame is still a sign-in form.
   */
  frameUrl?: string
  frameOrigin?: string
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

/**
 * How an effect reached the page. `cdp` is native input through the attached
 * debugger — real pointer and key events the page cannot tell from a user's;
 * `dom` is the content script's synthetic events and value setters. Chosen
 * before the action and recorded so the verifier knows what evidence it may
 * expect, and never changed afterwards: an action whose native delivery is
 * uncertain is not retried through the other backend.
 */
export type AgentInputBackend = "cdp" | "dom"

/**
 * What the page reported receiving while native input was in flight.
 *
 * `delivered`: exactly the planned events arrived, on the resolved target.
 * `misdirected`: the planned events arrived, but on some other element.
 * `partial`: the plan was cut short — some planned events arrived, the rest
 * did not, typically because the document went away or the run was stopped.
 * `undelivered`: no trusted input reached the document at all.
 * `interference`: trusted input the plan did not send was observed — a real
 * pointer or keyboard was in use while the agent acted, so what the page did
 * cannot be attributed to the agent alone.
 * `unknown`: the document could not be asked, usually because the action
 * navigated it away; the verifier falls back to page evidence.
 */
export type AgentInputDelivery =
  | "delivered"
  | "misdirected"
  | "partial"
  | "undelivered"
  | "interference"
  | "unknown"

export interface AgentExecutionReceipt {
  /** Ephemeral exact native submission destination. Contains form values; never persist or log. */
  submissionUrl?: string
  executedAt: number
  details?: string
  controlledTabId?: number
  backend?: AgentInputBackend
  inputDelivery?: AgentInputDelivery
  /**
   * The page asked the browser for a file while the action ran and the run's
   * debugger held the chooser back. Nothing was chosen; the step cannot be
   * finished by the run and is left for the user.
   */
  fileChooser?: boolean
  /** A held native dialog interrupted this activation; no input is replayed. */
  dialogOpened?: string
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
  /**
   * Whether this step changed the page rather than read it, taken from the
   * resolved effect's own classes. Durable because a completion is judged
   * against it and a worker restart keeps the receipts and loses everything
   * else — a run that submitted a form before the worker died still owes the
   * user evidence that the submission landed.
   */
  mutating?: boolean
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
  /**
   * Whether the run's model accepts images. Asked before a capture is taken,
   * so a text-only model costs the page no screenshot and is offered no
   * visual command. Absent means text-only.
   */
  vision?(
    state: AgentRunState,
    signal: AgentCancellationSignal
  ): Promise<boolean>
}

/** What a resolver may ground a command in besides the DOM observation. */
export interface AgentResolutionContext {
  screenshot?: AgentScreenshot
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
    observation: AgentObservation,
    context?: AgentResolutionContext
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
  wait?(ms: number, signal: AgentCancellationSignal): Promise<void>
}

export interface AgentController {
  start(runId: string): Promise<void>
  requestPause(runId: string, reason?: AgentPauseReason): Promise<void>
  resume(
    runId: string,
    correction?: { text: string; pausedAt: number }
  ): Promise<void>
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
  /** Absent means the host cannot picture the page; runs are text-only. */
  screenshot?: AgentScreenshotPort
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
