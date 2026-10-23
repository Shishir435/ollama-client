import type {
  AgentApprovalRequest,
  AgentCommand,
  AgentCompletionReview,
  AgentConsequentialEffect,
  AgentDecision,
  AgentDialogState,
  AgentError,
  AgentEvidenceRecord,
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
  AgentTaskConstraint,
  AgentTaskPlan,
  AgentTaskRequirement,
  AgentVisualFrame
} from "@ollama-client/contracts"
import type { AgentCompletionOutcomeClaim } from "./completion"
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
  /** The model asked for a fresh picture of the viewport. */
  look?: true
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

/**
 * One page the run has been on, read from every step it took there rather
 * than from the trimmed history: the history keeps the last dozen steps, so
 * a long run forgot the pages it had already opened and opened them again.
 * `visits` counts arrivals, `steps` every step taken from the page.
 */
export interface AgentVisitedPage {
  url: string
  visits: number
  steps: number
  lastStep: number
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
  evidenceLedger?: readonly AgentEvidenceRecord[]
  /**
   * How the step before this decision turned out. Declared since the loop was
   * written and never populated, so every decision was made as if it were the
   * first — the single largest cause of a run repeating an action it had
   * already completed.
   */
  previousVerification?: AgentVerificationResult
  /** Bounded, oldest-first record of what this run has already done. */
  history?: readonly AgentHistoryEntry[]
  /** Every page the run has been on, bounded; see `AgentVisitedPage`. */
  visited?: readonly AgentVisitedPage[]
  /**
   * The viewport as pictured with this observation, for a model that can see.
   * Absent for a text-only model, when the run holds no way to capture, or
   * when the page could not be pictured without exposing a sensitive control.
   */
  screenshot?: AgentScreenshot
  /**
   * Whether this step may ask for a picture with `look`, and if not, why.
   * Separate from `screenshot`: most steps carry no picture and may still
   * ask for one. Absent from a host that predates it, which offers no `look`.
   */
  visual?: AgentVisualAccess
}

/**
 * Why a run cannot be shown the page on this step, as the model is told it.
 * The model's own limit, the host's, the user's two answers — notice not
 * acknowledged, pictures turned off — and then the page's: a native dialog
 * freezes the renderer, and a document whose picture already came back
 * empty once is not asked again.
 */
export type AgentVisualUnavailableReason =
  | "model_text_only"
  | "no_capture_path"
  | "not_permitted"
  | "disabled_by_user"
  | "dialog_open"
  | "capture_failed"

export type AgentVisualAccess =
  | { available: true }
  | { available: false; reason: AgentVisualUnavailableReason }

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
  /**
   * The run's tabs, the one the user started on first, so the observation
   * can say which of them are still open and where. Absent on hosts that
   * cannot ask the browser.
   */
  scopedTabIds?: readonly number[]
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
  rowContext?: string
  inputType?: string
  observedValue?: string
  observedChecked?: boolean
  observedFocused?: boolean
  href?: string
  formAction?: string
  formMethod?: "get" | "post" | "dialog"
  /**
   * The GET query the approval's address was built from; the executor
   * refuses a submission whose live query differs.
   */
  formQuery?: string
  formFingerprint?: string
  formHasSensitiveControl?: boolean
  /** The page marks the form as a search; see `AgentElement.searchForm`. */
  searchForm?: boolean
  submitter?: boolean
  expectedValue?: string
  expectedChecked?: boolean
  /**
   * The CSS point a visual click named, in the target frame’s layout viewport. The
   * executor aims there rather than at the control's centre, and the page
   * confirms the control is still what lies under it before anything is sent.
   */
  point?: { x: number; y: number }
  /** Capture geometry for a child-frame click; revalidated before every dispatch. */
  visual?: { rootPoint: { x: number; y: number }; path: AgentVisualFrame[] }
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
  /**
   * Set on an activation whose control is labelled as ordering, paying,
   * sending or publishing something ("Place order", "Send"). A script button
   * commits as surely as a form submitter but has no submitter to classify.
   * Evidence, not a decision: policy never lets standing consent cover it.
   */
  committingLabel?: boolean
  /**
   * Set on an activation whose control is labelled as storing something
   * ("Save", "Update", "Mark as paid") that no form classifies. Evidence for
   * the repeat guard only: the click is recorded as a possible commit, so a
   * second press of the same control asks; standing consent still covers
   * the first.
   */
  savingLabel?: boolean
  /**
   * Set beside `committingLabel` when the label adds to a cart. Still a
   * possible commit; a step serving a requirement to buy may take it under
   * a limit that forbids paying.
   */
  cartLabel?: boolean
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

/**
 * One control a submission will send, as the observation showed it. Approval
 * evidence only: never sent to the page, never written to a receipt. A
 * sensitive control is named and its value withheld.
 */
export interface AgentSubmittedField {
  name: string
  value?: string
  checked?: boolean
  sensitive?: true
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
  /**
   * What a submission sends: every other control of the submitted form, in
   * page order, so its approval can show the whole form rather than the
   * button. Absent for anything that does not submit a form.
   */
  submitted?: {
    fields: readonly AgentSubmittedField[]
    /** Controls past the listed ones, counted rather than dropped silently. */
    omitted?: number
  }
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
    | {
        type: "policy"
        risk: AgentRisk
        authorizedAt: number
        /** Allowed by browse mode; its destination joins the allowlist. */
        browse?: true
        /**
         * The planned changes the user approved just now, as the card listed
         * them; recorded as the step executes.
         */
        planApproved?: readonly string[]
      }
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
  /**
   * Tabs the page opened from the controlled tab while this step ran — a
   * `target="_blank"` link, a `window.open` its handler made. Filled until
   * the step's verification settles, because the browser reports a new tab a
   * moment after the click that caused it. The run adopts them into its
   * scope: the page opened them because the run acted, so switching to one
   * is not reaching into a tab the user was working in.
   */
  openedTabIds?: number[]
  /**
   * The HTTP status of each write the page's own requests sent while this
   * step ran and the network answered with an error, `0` for one that got no
   * answer. Filled live until verification settles, like `openedTabIds`. It
   * is what the network said, and outranks any success the page displays.
   */
  failedWrites?: number[]
  /** Ephemeral, bounded page-authored WebMCP result; verification labels it untrusted. */
  pageToolResult?: string
  /** The WebMCP API reports navigation by resolving the invocation to null. */
  pageToolNavigation?: boolean
}

/** Bounds on the submitted values a GET submission's evidence carries. */
export const MAX_AGENT_SUBMITTED_VALUES = 8
export const MAX_AGENT_SUBMITTED_VALUE_CHARS = 200

export interface AgentVerificationEvidence {
  kind: string
  summary: string
  observedAt: number
  /** Bounded control names for a confirmed batch, in command order. */
  fields?: { name?: string }[]
  controlTransition?: {
    from: string
    to: string
    verificationId: string
    frameId: number
    documentId: string
  }
  /**
   * The values a confirmed GET submission sent, each with the label of the
   * control it came from when the observation showed one — what the form
   * actually carried, and so the only values that submission proves.
   * Absent for a POST, or a form with a hidden or sensitive control.
   */
  values?: { name?: string; value: string }[]
  /**
   * What a confirmed submission proves about the site's answer, as distinct
   * from the form having gone. `dispatched`: it went, and nothing the page
   * shows says whether the site took it. `accepted`: the page moved on and
   * shows no rejected control and no new alert. `rejected`: a control the
   * page marks invalid is showing. Only an accepted one completes anything;
   * absent, on a receipt written before the distinction existed, counts as
   * dispatched.
   */
  acceptance?: AgentSubmissionAcceptance
  /**
   * The tab a confirmed tab receipt's destination committed in. A tab is
   * led on from the page it opened at; this id is how the run's tab list
   * still finds it. Absent on receipts written before it existed.
   */
  tabId?: number
}

export type AgentSubmissionAcceptance = "dispatched" | "accepted" | "rejected"

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
  /**
   * `browse` marks an allow only browse mode gave: a read-only plan going
   * somewhere a change task would have asked about. Its destination joins
   * the run's allowlist the way an approved navigation's does.
   */
  /** `planned` marks an allow only the user's plan consent gave. */
  | { type: "allow"; risk: AgentRisk; browse?: true; planned?: true }
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
  /**
   * The effect sends a submission or payment to a form an earlier run in
   * this chain already sent one to, through a different control. Not proof
   * of a repeat — a checkout's next step posts to the same place — so the
   * user decides, told what the earlier run did, and cannot have decided in
   * advance.
   */
  repeatsPriorForm?: boolean
  /**
   * The same command on the same control this run already committed a
   * consequential effect through. Two rows can share a "Delete" label, so it
   * is asked rather than refused — but asked as a repeat, never granted, and
   * never mistaken for the first time. The case it exists for is a pause that
   * lost the page's own confirmation: the click landed, the dialog it raised
   * is gone, and a fresh approval would have read as the first delete.
   */
  repeatsCommittedEffect?: boolean
  /** Durable history could not prove whether this effect was already done. */
  committedEffectsUnknown?: boolean
  /**
   * Every planned outcome is a read. Browsing, searching and following links
   * then run without asking; anything that could change a site still asks.
   * See `browseAllows` in `policy.ts`.
   */
  browse?: boolean
  /**
   * What the plan's field, checkbox and selection checks say named controls
   * should hold. The approval marks a value that disagrees; it decides
   * nothing.
   */
  plannedValues?: readonly AgentPlannedValue[]
  /**
   * The step traces to a planned change and the user consented to the plan
   * running unasked. `commits` says the outcome it advances is itself a
   * submission, an order or a send, which is the only thing that lets a
   * submitting step through. See `plannedAllows` in `policy.ts`.
   */
  planned?: { commits: boolean }
  now: number
}

export interface AgentPlannedValue {
  name: string
  value?: string
  checked?: boolean
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
    | "constraints"
    | "deadline"
    | "controlledTabId"
    | "error"
    | "evidenceLedger"
    | "grants"
    | "humanDecision"
    | "injectionSuspected"
    | "observationCount"
    | "planApproved"
    | "planConsent"
    | "outcome"
    | "pauseReason"
    | "plan"
    | "question"
    | "recovery"
    | "requirements"
    | "result"
    | "scopedTabIds"
    | "stall"
    | "stepCount"
    | "workflow"
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
  /**
   * The visible text of the list or table row the control sits in, so a log
   * of three "Delete" clicks says which file each one was. Page text,
   * bounded, and dropped with the name for a sensitive control.
   */
  rowContext?: string
}

export interface AgentStepWrite {
  runId: string
  stepId: string
  status: AgentStepStatus
  at: number
  command?: AgentCommand
  /** Planned outcome this step was chosen to advance. */
  requirementId?: string
  risk?: AgentRisk
  /**
   * Whether this step changed the page rather than read it, taken from the
   * resolved effect's own classes. Durable because a completion is judged
   * against it and a worker restart keeps the receipts and loses everything
   * else — a run that submitted a form before the worker died still owes the
   * user evidence that the submission landed.
   */
  mutating?: boolean
  /**
   * Which classes of the effect a repeat would double — a submission, a
   * payment, a delete, a download — empty when none. Durable for the same
   * reason as `mutating`: a follow-up reads the receipts to learn what it
   * must not do again, long after the controller that took the step is gone.
   * Absent only on receipts written before it existed.
   */
  consequential?: AgentConsequentialEffect[]
  /**
   * Whether this confirmed write left its control holding exactly the value
   * its requirement's field or select check names. Recorded at verification,
   * the only moment both are known, so a completion can credit a field the
   * run then submitted off the page. A boolean, never the value itself.
   */
  heldPlannedValue?: boolean
  /**
   * Other requirements whose field, select or checked check this confirmed
   * write also held — one batched fill sets Name, Color and Agree for three
   * requirements under one id. Ids only, never a value.
   */
  heldPlannedFor?: string[]
  /**
   * Every word this write put on the page was already in the page's own
   * text before it, so the page saying it is not the run's echo. A boolean,
   * never the value.
   */
  shownBeforeWrite?: boolean
  /** The control added to a cart: a possible commit that pays for nothing. */
  cartAddition?: boolean
  /**
   * The ids a completion review had last found contradicted when this
   * receipt was written, empty once none is. It rides the receipt that
   * carries the review's own count, so a worker restart that rebuilds the
   * spent budget from receipts rebuilds this beside it. Ids only, never a
   * verdict's reasons or page text.
   */
  reviewContradicted?: string[]
  /**
   * Where a consequential submission was sent, origin and path only. The
   * form, not the control: Enter in a field and a click on its button send
   * the same thing.
   */
  formAction?: string
  verification?: AgentVerificationResult
  target?: AgentStepTarget
  /** The page the step was taken on, so history can say where it happened. */
  sourceUrl?: string
  /** Model-authored note attached to the step it belongs to. */
  finding?: string
  evidenceLedger?: AgentEvidenceRecord[]
  /**
   * The reasoning the model streamed for the decision that opened this step,
   * bounded, for the supervisor's card only. Never read back into a prompt.
   */
  thinking?: string
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
  /**
   * The refusal says the control or form moved after the decision while the
   * run was not touching it: someone else is editing the page. The run pauses
   * for the user instead of deciding again over their changes.
   */
  readonly outsideEdit: boolean

  constructor(
    message = "The observed target changed before execution",
    options: { outsideEdit?: boolean } = {}
  ) {
    super(message)
    this.name = "AgentEffectNotAppliedError"
    this.outsideEdit = options.outsideEdit === true
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
   * The reasoning the decision that just resolved streamed, bounded, for the
   * run named. A reader for the same reason as `decisionTelemetry`; a model
   * that streamed none, or a port that does not collect it, returns nothing.
   */
  decisionThinking?(runId: string): string | undefined
  /**
   * Malformed answers the run has spent from its budget so far, so the
   * controller can keep the count across a worker restart. The port reads the
   * count back from `state.stall.malformed` when it has none of its own.
   */
  malformedResponses?(runId: string): number | undefined
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
   * is weaker. Once a host supplies this port, planning is part of the safety
   * boundary: a failed or empty plan stops the run rather than silently
   * falling back to that weaker judge.
   */
  plan?(
    state: AgentRunState,
    signal: AgentCancellationSignal
  ): Promise<AgentTaskPlan>
}

/**
 * What an independent reviewer is shown, and all it is shown.
 *
 * A fresh context on purpose: no history, no page, no reasoning from the run
 * that is being judged. The goal and the requirements are the user's words as
 * the plan fixed them; the claims are the acting model's; the ledger is what
 * the runtime grounded. Only the ids a deterministic check could not decide
 * are listed, so the reviewer cannot be asked to re-open one that was settled.
 */
export interface AgentCompletionReviewRequest {
  goal: string
  requirements: readonly AgentTaskRequirement[]
  constraints: readonly AgentTaskConstraint[]
  claims: readonly AgentCompletionOutcomeClaim[]
  evidenceLedger: readonly AgentEvidenceRecord[]
  /**
   * Every requirement id of a plan that only reads, whether or not it is
   * under review; absent when the plan changes anything. A limit on such a
   * run is about its answer, and the answer's facts are bound to these.
   */
  answerIds?: readonly string[]
  /**
   * The name of the link the run followed to the page a fact was read on, by
   * record id: "Lead time: 7 days" says nothing of whose it is, read on the
   * page opened from "Contoso" it is Contoso's. Page-authored like the quote.
   */
  openedFrom?: Readonly<Record<string, string>>
  /**
   * Current page quotes, by record id, that first appeared after the verified
   * action bound to the same requirement and before the run changed anything
   * else. Absent when this worker holds no windows (a restart loses them),
   * which says nothing either way. Never support on its own: the runtime
   * still requires a citable record.
   */
  appearedAfterAction?: readonly string[]
  /**
   * The actions applied in each requirement's window, in order, as their
   * receipts record them: the command and the control's role and name, a
   * sensitive control's name withheld. A click and the confirmation it raised
   * are both listed. What connects newly observed text to the action an
   * outcome claims — text after "click Accept" is no evidence that Continue
   * was clicked. When limits are under review, every window's actions are
   * listed: a limit on how the run acted is about all of them.
   */
  actions?: readonly AgentReviewedAction[]
  /**
   * Whether `actions` is every change the run applied, read from its
   * receipts. Only then may a scope limit be supported by the run's own
   * effects: a list missing an untagged action could hide the one that broke
   * the limit.
   */
  actionsComplete?: boolean
  /**
   * The record each outcome under review is about, by outcome id: its own
   * check's record, else the one a sibling change's check or items name.
   * Plan wording, so context for judging "Record 6 Saved" and never a quote.
   */
  records?: Readonly<Record<string, string>>
  /**
   * The page the run completed on, as the runtime read it: its title and a
   * bounded excerpt of its visible text. Context for judging, never a
   * citation — only a ledger record can support a verdict.
   */
  page?: { title: string; text: string }
  /**
   * Outcomes the runtime already graded verified or supported, outside the
   * ids under review. Shown so a reviewer that sees one contradicted can say
   * so: a contradiction backed by a ledger record lowers that outcome to
   * claimed. Nothing a reviewer says about one can raise it or refuse the
   * completion over it.
   */
  checked?: readonly AgentTaskRequirement[]
}

export interface AgentReviewedAction {
  requirementId: string
  command: string
  role?: string
  name?: string
  /**
   * The element kind a pointer click resolved to, when it has no role or
   * name: a `click_point` on a canvas names no control, only that it pressed
   * one of this kind.
   */
  tag?: string
  /** Text newly observed after this action bound to its outcome, as a flag. */
  producedText?: boolean
  /** The key a `press_key` sent, withheld with the name on a sensitive control. */
  key?: string
  /** Where an `open_tab` or `navigate` went, origin and path only. */
  destination?: string
  /**
   * What a verified write left in each named control it set, as the command
   * sent it and the verifier confirmed it. Memory only, since receipts are
   * stored with values redacted; a sensitive or unnamed control is left out.
   */
  values?: AgentReviewedValue[]
}

export interface AgentReviewedValue {
  name: string
  /** The whole value a clear-and-type or a select left in the control. */
  value?: string
  /** Text a plain type added to whatever the control already held. */
  typed?: string
  checked?: boolean
}

/**
 * A second reading of a completion, with no browser behind it.
 *
 * It has no effect port, no approval port and no way to write the plan: its
 * answer is a verdict per id, which the runtime checks against the ledger
 * before believing any of it. A thrown error, a cancelled request and an
 * answer that cites nothing all leave the claim exactly as unreviewed.
 */
export interface AgentCompletionReviewPort {
  review(
    state: AgentRunState,
    request: AgentCompletionReviewRequest,
    signal: AgentCancellationSignal
  ): Promise<AgentCompletionReview>
  /** What the review that just resolved cost, read once like `decisionTelemetry`. */
  reviewTelemetry?(runId: string): AgentStepTelemetry | undefined
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
   * The other way out of an unresolved effect: the user looked at the page
   * and the task is done. The run completes on their word, without another
   * look, and its result says so.
   */
  finishReviewed(input: { runId: string; pausedAt: number }): Promise<void>
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
  /**
   * A correction typed while the run works, taken into the next decision
   * without pausing it. Queued rather than applied: the decision in flight
   * was asked before the user spoke, and the next one is the first that can
   * hear it. It cannot answer an approval, a question or an unresolved
   * effect — those still wait for their own control. Resolves whether it was
   * accepted: a run that is not working has no next decision to hear it.
   */
  steer?(runId: string, text: string): Promise<boolean>
}

export interface AgentControllerDependencies {
  model: AgentModelPort
  /**
   * Absent means no second opinion: a claim no deterministic check can
   * decide is sent back to the run and, if it returns unchanged, to the user.
   */
  review?: AgentCompletionReviewPort
  observation: AgentObservationPort
  /** Absent means the host cannot picture the page; runs are text-only. */
  screenshot?: AgentScreenshotPort
  /**
   * Whether the user allowed this run's pictures to travel. Asked after the
   * model's `vision`, which is a fact about the model; this is the user's
   * answer about the run. Absent means permitted.
   */
  screenshotsPermitted?: (state: AgentRunState) => Promise<boolean>
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
  message: string
): AgentError => ({ code, message })

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
 * below chose to say to a user — its i18n key and its user-facing sentence —
 * and nothing else; a provider's raw text can
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
  return {
    code,
    message: userMessage ?? fallbackMessage,
    ...(messageKey ? { messageKey } : {})
  }
}

export const pausePatch = (
  reason: AgentPauseReason,
  updatedAt: number
): AgentStatePatch => ({ pauseReason: reason, updatedAt })
