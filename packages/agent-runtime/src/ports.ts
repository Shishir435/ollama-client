import type {
  AgentApprovalRequest,
  AgentCommand,
  AgentDecision,
  AgentDialogState,
  AgentError,
  AgentGrant,
  AgentImageRect,
  AgentObservation,
  AgentObservationScope,
  AgentPageTool,
  AgentPauseReason,
  AgentRunState,
  AgentRunStatus,
  AgentScreenshot,
  AgentSnapshotIdentity,
  AgentStepStatus,
  AgentStepTelemetry,
  AgentTakeoverRequest,
  AgentTaskPlan
} from "@ollama-client/contracts"
import type { AgentVisionPolicy } from "./vision"

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
  /** Several scoped questions, answered by one walk of the document. */
  queries?: readonly string[]
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
  /**
   * A scoped read of the page, when the last decision asked for one. The
   * elements that come back are the scope's matches rather than the page's
   * overview, and the observation echoes the scope it was taken for.
   */
  scope?: AgentObservationScope
  /**
   * Several scoped questions asked together, when the last decision was an
   * `extract`. Answered by one walk of the document, and grouped by question
   * so the model can tell which rows answered which.
   */
  lookup?: { queries: readonly string[] }
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

/**
 * One control a batched fill sets, resolved and checked exactly as the
 * single-field command it mirrors. The command is grounded and complete, so
 * the executor and the page treat it as the lone edit it would otherwise be.
 */
export interface ResolvedAgentBatchField {
  command: AgentCommand
  target: ResolvedAgentTarget
}

export interface ResolvedAgentEffect {
  command: AgentCommand
  /**
   * The step's representative target. For a batch it is the first field's,
   * because policy asks its questions of one control and the resolver has
   * already refused any batch whose fields disagree on the answers that
   * matter — none is sensitive, none sits in another frame, and all carry
   * the same class of effect.
   */
  target: ResolvedAgentTarget
  /**
   * Every control a batched fill sets, in the order it sets them. Present
   * only for `fill_form`; the approval names the count and the verifier
   * checks each one, so a batch cannot be approved as one edit and then
   * verified as another.
   */
  batch?: { fields: readonly ResolvedAgentBatchField[] }
  /** WebMCP descriptor bound to the document and schema the model saw. */
  pageTool?: AgentPageTool
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
  /**
   * How many fields of a batched fill the page actually applied, in the order
   * they were sent. A batch stops at the first field it cannot place, so this
   * is what tells the verifier which fields to check and the model where to
   * resume — the one fact about a partial batch that cannot be read off the
   * page afterwards.
   */
  fieldsApplied?: number
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
  /** Ephemeral, bounded page-authored WebMCP result; verification labels it untrusted. */
  pageToolResult?: string
  /** The WebMCP API reports navigation by resolving the invocation to null. */
  pageToolNavigation?: boolean
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
  /**
   * The words this run supplied itself — the user's goal, their answers, and
   * the text it has typed or selected into the page. The egress rule reads it
   * to tell a field value the run authored from one the page put there;
   * absent means no such claim can be made, and the rule stays as strict as
   * it was. See `provenance.ts`.
   */
  authoredText?: readonly string[]
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
    | "outcome"
    | "pauseReason"
    | "question"
    | "requirements"
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
  /**
   * What the step cost, in numbers only. Optional because a step a worker
   * restart settled measured nothing, and an absent record must read as
   * unmeasured rather than as zero.
   */
  telemetry?: AgentStepTelemetry
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
  /**
   * When the run may picture the page, as the user asked for it.
   *
   * Separate from `vision`, which answers a fact about the model. This
   * answers a preference about the run, and the two are different questions:
   * a model that can see does not have to be shown everything. Absent means
   * `always`, which is what every port did before this existed.
   */
  visionPolicy?(
    state: AgentRunState,
    signal: AgentCancellationSignal
  ): Promise<AgentVisionPolicy>
  /**
   * What the decision that just resolved cost, for the run named.
   *
   * A reader rather than part of `decide`'s result because the provider's own
   * usage is the only thing the controller cannot measure for itself, and
   * widening the return type would rewrite every test double of this port for
   * a field most of them do not produce. Read it immediately after the await,
   * while the answer still belongs to that decision; a port that measured
   * nothing returns nothing.
   */
  decisionTelemetry?(runId: string): AgentStepTelemetry | undefined
  /**
   * What the goal asks for, decided before the run looks at anything.
   *
   * Taken from the goal alone and on purpose: the model has not seen the page
   * yet, so it cannot yet know which of the outcomes will turn out to be the
   * inconvenient one. A list proposed after the first look is a list that can
   * be shaped around what the page makes easy.
   *
   * Optional because a host that cannot plan must still be able to run. That
   * run is judged the way runs were judged before requirements existed, which
   * is weaker — so a host that can plan should.
   */
  plan?(
    state: AgentRunState,
    signal: AgentCancellationSignal
  ): Promise<AgentTaskPlan>
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
   * Records that the user has reviewed a page whose effect could not be
   * resolved, and continues the run from a fresh observation.
   *
   * Nothing is replayed: the run looks at the page again and decides from
   * what is actually there. Without this the only exit from an unresolved
   * effect is to stop and start the whole goal over, which is the more
   * dangerous of the two — a new run carries no memory that the click already
   * happened, so it is the path that repeats the action. The moment being
   * resolved is named so a click on a stale panel cannot resolve whatever
   * replaced it.
   */
  resolveEffect(input: { runId: string; pausedAt: number }): Promise<void>
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

const textProperty = (value: unknown, key: string): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.slice(0, 1_000)
    : undefined
}

/**
 * A failure the layer below already named, kept rather than replaced.
 *
 * Read structurally, not by instance: this package knows nothing about the
 * host's error classes and must not start. What it takes is what the layer
 * below chose to say to a user — its i18n key, its user-facing sentence and
 * whether it is worth retrying — and nothing else; a provider's raw text can
 * carry a URL or a key, so only these declared fields travel.
 *
 * Collapsing all of it into one sentence is how a wedged local proxy
 * answering 503 reached a user as "the model could not be reached, check the
 * provider is running" while the provider was perfectly healthy.
 */
export const agentProviderFailure = (
  code: AgentError["code"],
  error: unknown,
  fallbackMessage: string
): AgentError => {
  const messageKey = textProperty(error, "messageKey")
  const userMessage = textProperty(error, "userMessage")
  const retryable = (error as { retryable?: unknown } | null)?.retryable
  return {
    code,
    message: userMessage ?? fallbackMessage,
    ...(messageKey ? { messageKey } : {}),
    retryable: retryable === true
  }
}

export const pausePatch = (
  reason: AgentPauseReason,
  updatedAt: number
): AgentStatePatch => ({ pauseReason: reason, updatedAt })
