import type {
  AgentApprovalRequest,
  AgentCommand,
  AgentObservationScope
} from "@ollama-client/contracts"
import {
  AGENT_ROUTINE_GRANT_EFFECTS,
  agentObservationBudget,
  AgentCompletionReviewSchema,
  type AgentDecision,
  AgentDecisionSchema,
  type AgentGrantableEffect,
  type AgentObservation,
  AgentObservationSchema,
  type AgentPauseReason,
  type AgentRecoveryStrategy,
  type AgentRecoveryTrigger,
  type AgentRunState,
  type AgentRunStatus,
  type AgentScreenshot,
  type AgentStallState,
  type AgentStepTelemetry,
  type AgentTaskPlan,
  MAX_AGENT_ALLOWED_ORIGINS,
  MAX_AGENT_ANSWER_CHARS,
  MAX_AGENT_ANSWERS,
  MAX_AGENT_GRANTS,
  MAX_AGENT_OBSERVATION_CEILING,
  MAX_AGENT_PROGRESS_POINTS,
  MAX_AGENT_SCOPED_TABS
} from "@ollama-client/contracts"
import {
  type AgentProgressPoint,
  hashAgentProgressUrl,
  agentDecisionFingerprint,
  agentRunActiveBudgetMs,
  agentTextChangeSignature,
  beginAgentStepDeadline,
  classifyNoProgress,
  expiredAgentDeadline,
  hashAgentObservation,
  initialAgentDeadlineState,
  resumeAgentDeadlines,
  suspendAgentDeadlines
} from "./budgets"
import type { AgentCompletionJudgement } from "./completion"
import {
  agentAppliedChanges,
  agentEffectChangesPage,
  agentReadbackProbeFeedback,
  isAgentChangeReceipt,
  isAppliedAgentStepStatus,
  judgeAgentCompletion,
  prematureUnmetFeedback
} from "./completion"
import {
  agentClaimedReviewScope,
  agentCompletionNeedsReview,
  agentCompletionReviewRequest,
  applyAgentClaimedReview,
  agentRecordedContradictions,
  agentRecordedReviews,
  agentReviewVerdictsOf,
  applyAgentCompletionReview,
  applyAgentReviewDowngrades,
  MAX_AGENT_COMPLETION_REVIEWS
} from "./completion-review"
import {
  agentQuotePageLink,
  agentWriteHeldPlannedValue
} from "./completion-support"
import { agentObservationFailureMessage } from "./control-failure"
import {
  agentCommandEvidence,
  agentUnretainedSighting,
  agentWriteShownBefore,
  agentUnretainedSource,
  agentCompletionEvidence,
  agentUserEvidence,
  agentVerificationEvidence,
  boundAgentEvidence,
  buildAgentEvidenceLedger
} from "./evidence-ledger"
import {
  agentStepSourceUrl,
  agentStepTargetFrom,
  buildAgentFindings,
  buildAgentHistory,
  buildAgentVisitedPages,
  currentAgentInspection,
  lastVerifiedAgentHistoryStep,
  latestAgentSteps,
  previousAgentVerification
} from "./history"
import { agentObservationNeedsHuman } from "./human-boundary"
import { agentPageLooksInjected } from "./injection"
import { agentObservationHaystack } from "./observed-text"
import {
  agentPageItemsCarried,
  agentReceiptOpensPageItem,
  agentPlanWithPageLinks
} from "./plan-page-items"
import {
  agentAmendedPlanPatch,
  agentConfirmedRemovalPatch,
  agentConstraintRefusal,
  agentForbiddingConstraints,
  agentRequirementRecords,
  agentRowOutsideScope,
  agentWrongRowRecord,
  agentInitialPlanPatch,
  agentPlanNeedsReconciling
} from "./plan-record"
import type {
  AgentCancellationController,
  AgentController,
  AgentControllerDependencies,
  AgentExecutionReceipt,
  AgentInspectionFocus,
  AgentModelInput,
  AgentPlannedValue,
  AgentPolicyDecision,
  AgentResolutionContext,
  AgentReviewedAction,
  AgentReviewedValue,
  AgentRisk,
  AgentStatePatch,
  AgentStepReadout,
  AgentStepWrite,
  AgentVerificationResult,
  AgentVisualAccess,
  AgentVisualUnavailableReason,
  AuthorizedAgentEffect,
  ResolvedAgentEffect
} from "./ports"
import {
  AgentEffectNotAppliedError,
  AgentMalformedDecisionError,
  agentFailure,
  agentProviderFailure,
  MAX_AGENT_SUBMITTED_VALUE_CHARS,
  pausePatch
} from "./ports"
import {
  agentCommittedEffects,
  agentConsequentialEffects,
  agentConsequentialForm,
  agentEffectIsConsequential,
  agentOwnEffectSettlement,
  agentRepeatsBeforeClaim,
  agentRepeatsPriorEffect,
  agentRepeatWasRefused,
  agentRepeatsPriorForm
} from "./prior-effects"
import { agentAuthoredText } from "./provenance"
import {
  AGENT_CONFIRMED_REPEAT_FEEDBACK,
  AGENT_REPEAT_AFTER_CLAIM_FEEDBACK,
  AGENT_RECOVERY_REPEAT_FEEDBACK,
  planAgentRecovery,
  settledAgentRecovery
} from "./recovery"
import { agentResolutionFailure } from "./resolution-failure"
import { agentRunResult } from "./run-result"
import {
  agentRunTokens,
  agentTelemetryTokens,
  MAX_AGENT_RUN_TOKENS,
  withoutAgentTelemetryTokens
} from "./run-token-budget"
import {
  AGENT_STATUS_PREDECESSORS,
  agentTabScope,
  isLegalAgentTransition,
  isTerminalAgentStatus
} from "./state"
import { mergeAgentStepTelemetry } from "./telemetry"
import { agentCommandKeepingUserTab } from "./user-tab"
import { classifyVerificationOutcome } from "./verification"
import { type AgentVisionPolicy, agentPictureWarranted } from "./vision"
import { buildAgentWorkflow } from "./workflow"

/**
 * The result of a run the user finished after reviewing the page. Run data
 * rather than panel copy, like every other result: the chat that delegated
 * the task reads it.
 */
const AGENT_USER_CONFIRMED_RESULT =
  "The user reviewed the page and confirmed the task is done."

/** Two runs' worth of steps: the live one and one just settled. */
const MAX_LIVE_COMMANDS = MAX_AGENT_OBSERVATION_CEILING * 2
const MAX_LIVE_COMMAND_CHARS = 64 * 1024

const MAX_CONSECUTIVE_NO_PROGRESS = 3

/**
 * The recovery accounting a confirmed step leaves behind. A page-changing
 * step that verified is the run back on ground it can trust, so the open
 * episode closes; a read that verified changed nothing and leaves it open,
 * or one look would end every episode. The spent count never changes here.
 */
/** Closes an open episode when the user has spoken; keeps the spent count. */
const settledRecoveryPatch = (state: AgentRunState): AgentStatePatch =>
  state.recovery?.active
    ? { recovery: settledAgentRecovery(state.recovery) }
    : {}

const recoveryAfterVerified = (
  verifying: AgentRunState,
  recoveryPatch: AgentStatePatch,
  effect: ResolvedAgentEffect
): AgentStatePatch => {
  const recovery = recoveryPatch.recovery ?? verifying.recovery
  if (!recovery) return {}
  if (!recovery.active || !agentEffectChangesPage(effect)) return { recovery }
  return { recovery: settledAgentRecovery(recovery) }
}

const ownEffectPolicyFlags = (state: "repeat" | "unknown" | "none") =>
  state === "repeat"
    ? { repeatsCommittedEffect: true }
    : state === "unknown"
      ? { committedEffectsUnknown: true }
      : {}

/**
 * How the executor said the page refused an effect, when it said.
 *
 * The message is one of a closed vocabulary the extension composes for
 * exactly this — `target_replaced`, `value_changed`, `target_covered` and the
 * rest, sometimes with the identity field appended — so it is our own words
 * about the page rather than the page's own words, and safe both to record
 * and to hand back to the model. Bounded anyway, because a record read into
 * a prompt is bounded whatever it holds.
 */
const MAX_REFUSAL_CAUSE_CHARS = 200

const refusalCause = (error: unknown): string | undefined => {
  const message =
    error instanceof AgentEffectNotAppliedError ? error.message.trim() : ""
  return message.length > 0
    ? message.slice(0, MAX_REFUSAL_CAUSE_CHARS)
    : undefined
}

/**
 * What became of a command the model proposed.
 *
 * `refused` is the one that needed saying: the resolver would not ground the
 * command, nothing was attempted, and the run carries on with the refusal in
 * its history. Collapsing it into `stopped` is what made the first refusal
 * fatal.
 */
type AgentResolutionOutcome =
  | { type: "resolved"; effect: ResolvedAgentEffect }
  | { type: "refused"; state: AgentRunState | undefined }
  | { type: "stopped" }

/**
 * Commands the resolver may refuse before the run gives up on the model.
 *
 * Three, matching the no-progress budget, and consecutive: a refusal is the
 * model's mistake and it is told what the mistake was, so a model that can
 * use the correction gets to. One that cannot is answering with controls the
 * page does not offer, and no number of further looks changes that.
 */
const OUTSTANDING_EFFECT_FEEDBACK =
  "The user's newest answer has not been folded into the plan yet, and it may forbid this. Nothing that cannot be undone runs until it has. Do something else for now, or ask_user."

const OUTSTANDING_ANSWER_FEEDBACK =
  "The user's newest answer has not been folded into the plan yet, and it may ask for more than the plan lists. Act on everything the user has asked, then complete again."

/**
 * Told to the model when a step's control sits in another planned record's
 * row. The record is the plan's own wording, never page text.
 */
const wrongRowFeedback = (requirementId: string, other: string): string =>
  `This control sits in the row for "${other}", which is not what ${requirementId} is about. It was not attempted. Use the control in the row of the record ${requirementId} names.`

const outsideScopeFeedback = (
  requirementId: string,
  constraint: { id: string; text: string }
): string =>
  `This control sits in a row that names none of the records ${requirementId} is about, and ${constraint.id} says "${constraint.text}". It was not attempted. Use the control whose row names the record; read each control's row, not its position.`

const unretainedSightingFeedback = (
  requirementId: string,
  item: string
): string =>
  `This page names "${item}", which ${requirementId} asks you to read, and nothing from it has been retained. It was not attempted. Retain every line here that answers ${requirementId} as sourceQuotes on this same command, then leave; if nothing here answers it, issue the command again.`

const unretainedSourceFeedback = (
  requirementId: string,
  link: string
): string =>
  `You opened this page from "${link}", and nothing from it has been retained for ${requirementId}, which asks you to read. It was not attempted. Retain every line here that answers ${requirementId} as sourceQuotes on this same command, then leave; if nothing here answers it, issue the command again.`

/**
 * Finishing on a source page with nothing kept from it: the last tab of a
 * list is never left, so the guard on leaving never reached it, and its
 * answer went into the summary unquoted.
 */
const unretainedAtCompletionFeedback = (
  requirementId: string,
  link: string
): string =>
  `You opened this page from "${link}", and nothing from it has been retained for ${requirementId}, which asks you to read. The completion was not judged. Complete again with every line here that answers ${requirementId} as sourceQuotes.`

const MAX_CONSECUTIVE_REFUSED_COMMANDS = 3

/** Pending items a second challenge names; the plan bounds the rest. */
const MAX_PENDING_ITEMS_NAMED = 8

/** The most observations a failed plan amendment waits before it is asked again. */
const MAX_PLAN_AMENDMENT_BACKOFF = 8

/** Corrections one decision will take in at once; older ones are dropped. */
const MAX_QUEUED_STEERING = 3

/** How long an inconclusive effect is given before the page is read again. */
const UNRESOLVED_EFFECT_SETTLE_MS = 3_000

/**
 * Reads a pause or stop may take before it gives up. Each failed attempt means
 * the loop moved the run between the read and the compare-and-set, which a
 * live run does a handful of times per step, so a few rereads always land.
 */
const MAX_STOP_ATTEMPTS = 8

/**
 * What a re-recorded step keeps from the receipt it restates. A disposition
 * that dropped a field would leave the step's last receipt saying less than
 * its first — and `consequential` is what a follow-up reads to learn what it
 * must not do again.
 */
const restatedStepEvidence = (
  step: AgentStepReadout
): Pick<
  AgentStepWrite,
  | "command"
  | "mutating"
  | "heldPlannedValue"
  | "heldPlannedFor"
  | "shownBeforeWrite"
  | "cartAddition"
  | "consequential"
  | "formAction"
  | "target"
  | "sourceUrl"
  | "finding"
> => ({
  ...(step.command ? { command: step.command } : {}),
  ...(step.mutating !== undefined ? { mutating: step.mutating } : {}),
  ...(step.heldPlannedValue ? { heldPlannedValue: true } : {}),
  ...(step.heldPlannedFor?.length
    ? { heldPlannedFor: step.heldPlannedFor }
    : {}),
  ...(step.shownBeforeWrite ? { shownBeforeWrite: true } : {}),
  ...(step.cartAddition ? { cartAddition: true } : {}),
  ...(step.consequential !== undefined
    ? { consequential: step.consequential }
    : {}),
  ...(step.formAction ? { formAction: step.formAction } : {}),
  ...(step.target ? { target: step.target } : {}),
  ...(step.sourceUrl ? { sourceUrl: step.sourceUrl } : {}),
  ...(step.finding ? { finding: step.finding } : {})
})

/**
 * Told to the model when it reaches for an effect the run it follows already
 * committed. A template, never the control's label: the label is page text,
 * and the model already has it in `previousRun`.
 */
const REPEATED_EFFECT_FEEDBACK =
  "An earlier run this task follows already did this (see previousRun.effects). It is not done twice. Choose a different step, complete if the goal is met, or ask_user."

/**
 * Completions the judge may refuse for the same reason before the run asks.
 *
 * Two, and lower than the command budget on purpose. A refused command is
 * told what was wrong with the command, and the next one can be different; a
 * refused completion is told what was wrong with a claim the model believes
 * it has already proved, and a model that believes that says it again. Three
 * live runs finished their task, were refused, and re-claimed the same thing
 * until the observation budget ran out — twenty-odd observations spent
 * telling the user nothing. The second identical refusal is the point where
 * looking again has stopped being the useful move, so the run asks instead.
 *
 * Counted per reason: a run refused for missing evidence that comes back with
 * a quotation the page does not show has not repeated itself, it has moved,
 * and its next refusal starts its own count.
 */
const MAX_CONSECUTIVE_REFUSED_COMPLETIONS = 2

/**
 * An origin joins a run's allowlist only when the user approved travelling to
 * it — or, for a read-only plan, when browse mode let the run go there, which
 * is the user's start approval covering looking around — and only in the
 * durable write that opens execution — the same boundary
 * that owns the effect the approval authorized. A policy `allow`, a page, and
 * a model decision each contribute none, and the run's own cap is honoured by
 * declining to grow rather than by evicting an origin the user already
 * approved: a full allowlist costs another prompt, never a silent grant.
 */
/**
 * Every planned outcome is a read, so the run is browsing. A run with no
 * plan yet, or one still owing an unresolved requirement, is not: browse
 * mode is earned by a plan the user's start approval covered.
 */
export const agentPlanIsReadOnly = (
  state: Pick<AgentRunState, "requirements">
): boolean =>
  (state.requirements?.length ?? 0) > 0 &&
  (state.requirements ?? []).every((requirement) => requirement.kind === "read")

/** How much of the plan the approval lists, from the request's own bound. */
const MAX_PLAN_APPROVAL_EVIDENCE_CHARS = 1_000

/**
 * The planned change a step traces to, when the user approved it on a plan
 * card in these exact words. A reworded outcome is a different outcome.
 */
const planApprovedFor = (
  state: Pick<AgentRunState, "planApproved" | "requirements">,
  requirementId: string | undefined
): boolean => {
  const requirement = state.requirements?.find(
    (entry) => entry.id === requirementId
  )
  return Boolean(requirement && state.planApproved?.includes(requirement.text))
}

/**
 * The one approval plan consent asks for: the plan itself, its outcomes and
 * limits listed as the run holds them, before the first planned step it does
 * not yet cover. The start prompt could only show the goal, because the plan
 * did not exist yet. The step's own outcome is listed first and the other
 * changes after it, so what the card cannot fit is never what it approves:
 * approving covers exactly the changes listed, and the rest ask again.
 */
const planApprovalRequest = (
  state: AgentRunState,
  risk: AgentRisk,
  requirementId: string | undefined,
  now: number
): { request: AgentApprovalRequest; approved: string[] } => {
  const requirements = state.requirements ?? []
  const changes = requirements.filter((entry) => entry.kind === "change")
  const lines: { text: string; change?: string }[] = [
    ...changes
      .filter((entry) => entry.id === requirementId)
      .concat(changes.filter((entry) => entry.id !== requirementId))
      .map((entry) => ({ text: `• ${entry.text}`, change: entry.text })),
    ...(state.constraints ?? []).map((entry) => ({ text: `✕ ${entry.text}` })),
    ...requirements
      .filter((entry) => entry.kind !== "change")
      .map((entry) => ({ text: `• ${entry.text}` }))
  ]
  let evidence = ""
  const listed = new Set(state.planApproved ?? [])
  for (const line of lines) {
    const next = evidence ? `${evidence}\n${line.text}` : line.text
    if (next.length > MAX_PLAN_APPROVAL_EVIDENCE_CHARS) break
    evidence = next
    if (line.change) listed.add(line.change)
  }
  return {
    request: {
      id: `${state.id}:plan:${state.plan?.version ?? 1}:${state.planApproved?.length ?? 0}`,
      runId: state.id,
      stepId: `${state.id}:plan`,
      risk: risk === "low" ? "medium" : risk,
      action: "Run this plan without asking at each step",
      consequence:
        "Steps that follow the outcomes below run without asking, including a send or an order the plan names. Anything outside the plan, deleting, signing in and paying still ask. Reject to pause and be asked at every step.",
      display: {
        action: { key: "agent.approval_text.approve_plan" },
        consequence: [{ key: "agent.approval_text.approve_plan_consequence" }]
      },
      ...(evidence ? { pageEvidence: evidence } : {}),
      createdAt: now
    },
    approved: changes
      .map((entry) => entry.text)
      .filter((text) => listed.has(text))
  }
}

/**
 * Outcomes of sending, ordering, posting, booking or saving, stated as the
 * state they leave: a planned outcome that reads as one may submit; any other
 * may only prepare. Only the finished forms count, because a plan states
 * outcomes rather than steps, and the bare forms double as nouns — "the
 * submit button", "the order form", "the booking register", "the save
 * slot". English, like the plan's own boundary rules; a plan in another
 * language keeps asking at the send, which is the safe direction.
 */
const COMMITTING_VERBS =
  "submitted|sent|posted|published|placed (?:the|an|my|your) order|order (?:is|was|has been) placed|ordered|purchased|bought|booked|reserved|registered|signed up|subscribed|confirmed|checked out|applied|saved|created|added to"
const COMMITTING_OUTCOME = new RegExp(`\\b(?:${COMMITTING_VERBS})\\b`, "i")
/** The same verbs denied: "saved, not posted", "without submitting". */
const DENIED_OUTCOME = new RegExp(
  `(?:\\b(?:not|never|without|no)\\b|n't)[^.;]{0,40}\\b(?:${COMMITTING_VERBS}|submit|submitting|send|sending|post|posting|publish|publishing|order|ordering|buy|buying|book|booking|save|saving)\\b`,
  "i"
)

/**
 * A check that reads a control's value, box or option: the outcome is a
 * filled form, whatever its words say, and filling one never submits it.
 */
const FILL_CHECKS: ReadonlySet<string> = new Set([
  "field",
  "checked",
  "selected"
])

/**
 * The plan consent a step carries into policy: the run has it, no page has
 * looked like an injection, and the step names a planned change. Whether it
 * may submit reads the outcome's own text — never the goal words it quotes,
 * which can ask for a send the outcome itself only prepares — and never a
 * denial, a fill check, or a run whose constraints forbid a submission or a
 * payment.
 */
const plannedConsentFor = (
  state: Pick<
    AgentRunState,
    "planConsent" | "injectionSuspected" | "requirements" | "constraints"
  >,
  requirementId: string | undefined
): { planned?: { commits: boolean } } => {
  if (!state.planConsent || state.injectionSuspected || !requirementId)
    return {}
  const requirement = state.requirements?.find(
    (entry) => entry.id === requirementId && entry.kind === "change"
  )
  if (!requirement) return {}
  const forbidden = (state.constraints ?? []).some((constraint) =>
    constraint.forbids?.some(
      (effect) => effect === "submission" || effect === "payment"
    )
  )
  return {
    planned: {
      commits:
        !forbidden &&
        !(requirement.check && FILL_CHECKS.has(requirement.check.type)) &&
        COMMITTING_OUTCOME.test(requirement.text) &&
        !DENIED_OUTCOME.test(requirement.text)
    }
  }
}

/** The values the plan's checks name, for the approval to compare against. */
const plannedValuesFor = (
  state: Pick<AgentRunState, "requirements">
): { plannedValues?: AgentPlannedValue[] } => {
  const planned = (state.requirements ?? []).flatMap(
    (requirement): AgentPlannedValue[] => {
      const check = requirement.check
      if (!check) return []
      if (check.type === "field" || check.type === "selected")
        return [{ name: check.name, value: check.value }]
      if (check.type === "checked")
        return [{ name: check.name, checked: check.checked }]
      return []
    }
  )
  return planned.length ? { plannedValues: planned } : {}
}

const allowedOriginsPatch = (
  state: AgentRunState,
  effect: ResolvedAgentEffect,
  authorization: AuthorizedAgentEffect["authorization"]
): AgentStatePatch => {
  const origin = effect.destination?.origin
  if (
    (authorization.type !== "approval" &&
      !(authorization.type === "policy" && authorization.browse)) ||
    !origin ||
    state.allowedOrigins.includes(origin) ||
    state.allowedOrigins.length >= MAX_AGENT_ALLOWED_ORIGINS
  ) {
    return {}
  }
  return { allowedOrigins: [...state.allowedOrigins, origin] }
}

/**
 * A tab joins the run's scope in the same write that moves the run onto it,
 * and only after verification confirmed the destination it holds. A tab the
 * run opened itself and a tab the user approved switching to arrive here the
 * same way; nothing else does. A full scope still moves the run — the tab was
 * confirmed — and `agentTabScope` keeps the controlled tab in scope anyway.
 */
const adoptedTabPatch = (
  state: AgentRunState,
  controlledTabId: number | undefined,
  openedTabIds: readonly number[] = []
): AgentStatePatch => {
  const scope = agentTabScope(state)
  const joined = [...scope]
  for (const tabId of [
    ...openedTabIds,
    ...(controlledTabId === undefined ? [] : [controlledTabId])
  ]) {
    if (!joined.includes(tabId) && joined.length < MAX_AGENT_SCOPED_TABS)
      joined.push(tabId)
  }
  const widened = joined.length > scope.length
  if (controlledTabId === undefined)
    return widened ? { scopedTabIds: joined } : {}
  return widened
    ? { controlledTabId, scopedTabIds: joined }
    : { controlledTabId }
}

/** Verified kinds that confirm the controls hold what the command sent. */
const REVIEWED_WRITE_KINDS = new Set(["field", "fields", "checked"])

/** What one command left in its control, if it names it and may show it. */
const reviewedValue = (
  command: AgentCommand,
  target: ResolvedAgentEffect["target"]
): AgentReviewedValue | undefined => {
  const name = target.sensitive ? undefined : agentStepTargetFrom(target)?.name
  if (!name) return undefined
  const clipped = (text: string) =>
    text.slice(0, MAX_AGENT_SUBMITTED_VALUE_CHARS)
  if (command.type === "clear_and_type")
    return { name, value: clipped(command.text) }
  if (command.type === "select") return { name, value: clipped(command.value) }
  if (command.type === "type") return { name, typed: clipped(command.text) }
  if (command.type === "check") return { name, checked: true }
  if (command.type === "uncheck") return { name, checked: false }
  return undefined
}

/**
 * The values a confirmed write left, field by field. A reviewer shown only
 * that a `fields` receipt exists could not tell which values it confirmed,
 * and refused a form filled exactly as asked. A batch lists only the fields
 * its evidence confirmed, in command order.
 */
const reviewedValues = (
  effect: ResolvedAgentEffect,
  verification: AgentVerificationResult | undefined
): { values?: AgentReviewedValue[] } => {
  if (
    verification?.outcome !== "confirmed" ||
    !REVIEWED_WRITE_KINDS.has(verification.evidence.kind)
  )
    return {}
  const fields = effect.batch
    ? effect.batch.fields.slice(
        0,
        verification.evidence.fields?.length ?? effect.batch.fields.length
      )
    : [{ command: effect.command, target: effect.target }]
  const values = fields.flatMap((field) => {
    const value = reviewedValue(field.command, field.target)
    return value ? [value] : []
  })
  return values.length ? { values } : {}
}

/** An applied step as the reviewer is shown it, a sensitive name withheld. */
const reviewedAction = (
  effect: ResolvedAgentEffect,
  verification?: AgentVerificationResult
): Omit<AgentReviewedAction, "requirementId"> => {
  const target = agentStepTargetFrom(effect.target)
  return {
    command: effect.command.type,
    ...(target?.role ? { role: target.role } : {}),
    ...(target?.name ? { name: target.name } : {}),
    ...(effect.command.type === "press_key" && !effect.target.sensitive
      ? { key: effect.command.key }
      : {}),
    ...reviewedDestination(effect.command),
    ...reviewedValues(effect, verification)
  }
}

/** Where a command that names an address went, as receipts keep a URL. */
const reviewedDestination = (
  command: AgentCommand | undefined
): { destination?: string } => {
  if (command?.type !== "open_tab" && command?.type !== "navigate") return {}
  const destination = agentStepSourceUrl(command.url)
  return destination ? { destination } : {}
}

/**
 * Every change the run applied and every tab it opened, in durable order:
 * what a limit's reviewer judges how the run acted by.
 */
const reviewedActions = (
  steps: readonly AgentStepReadout[]
): AgentStepReadout[] => {
  const changes = agentAppliedChanges(steps)
  const opened = latestAgentSteps(steps).filter(
    (step) =>
      step.command?.type === "open_tab" &&
      isAppliedAgentStepStatus(step.status) &&
      !changes.some((change) => change.stepId === step.stepId)
  )
  return [...changes, ...opened].sort(
    (first, second) => first.sequence - second.sequence
  )
}

/**
 * An applied receipt as a scope limit's reviewer is shown it. A named key is
 * kept, a single character is not: one typed into a sensitive field is that
 * field's value, and a receipt no longer says whether the field was sensitive.
 */
const appliedReviewedAction = (step: AgentStepReadout): AgentReviewedAction => {
  const key =
    step.command?.type === "press_key" && step.command.key.length > 1
      ? step.command.key
      : undefined
  return {
    requirementId: step.requirementId ?? "unbound",
    command: step.command?.type ?? "unknown",
    ...(step.target?.role ? { role: step.target.role } : {}),
    ...(step.target?.name ? { name: step.target.name } : {}),
    ...(key ? { key } : {}),
    ...reviewedDestination(step.command)
  }
}

/**
 * Which budget ran out. One code for three causes told a user whose run hit
 * its time limit that it had used its whole step budget, which pointed them
 * at the wrong fix; the code still says a budget ended the run.
 */
const AGENT_BUDGET_MESSAGE_KEYS = {
  steps: "agent.failure.budget_exhausted",
  time: "agent.failure.budget_exhausted_time",
  tokens: "agent.failure.budget_exhausted_tokens"
} as const

export const createAgentController = (
  dependencies: AgentControllerDependencies
): AgentController => {
  const createCancellationController =
    dependencies.createCancellationController ??
    (() => {
      let aborted = false
      const listeners = new Set<() => void>()
      const controller: AgentCancellationController = {
        signal: {
          get aborted() {
            return aborted
          },
          addEventListener(_type, listener) {
            listeners.add(listener)
          },
          removeEventListener(_type, listener) {
            listeners.delete(listener)
          }
        },
        abort() {
          if (aborted) return
          aborted = true
          for (const listener of listeners) listener()
          listeners.clear()
        }
      }
      return controller
    })
  const active = new Map<string, AgentCancellationController>()
  const lastGeneration = new Map<string, number>()
  const minimumGeneration = new Map<string, number>()
  const previousProgress = new Map<string, AgentProgressPoint>()
  const recentProgress = new Map<string, AgentProgressPoint[]>()
  /**
   * Ids of page facts the run has ever held. The ledger is capped and its
   * length falls as old records age out, so growth is read off this set.
   */
  const factsSeen = new Map<string, Set<string>>()
  /** The visible text the guard last saw, to sign what the next step changed. */
  const progressText = new Map<string, string>()
  /** Requirements a run was already asked about once after reporting them unmet. */
  const challengedUnmet = new Map<string, Set<string>>()
  /** Outcomes already given the one extra challenge for pending page items. */
  const itemChallenged = new Map<string, Set<string>>()
  /** The requirement a verified opener advanced, bound to the dialog it opened. */
  const lastBoundRequirement = new Map<
    string,
    { requirementId: string; dialogId: string }
  >()
  const clearBoundRequirement = (runId: string): void => {
    lastBoundRequirement.delete(runId)
  }
  /**
   * The page as it read when this run's last change was decided.
   *
   * Evidence that was already true then cannot be evidence of the change, so
   * the completion judge is given it to refuse with. One entry: the service
   * admits one run at a time, so a second run replaces it rather than
   * accumulating a page of text per run, and a worker restart simply loses it
   * — the judge treats an absent baseline as unknown rather than as proof the
   * evidence is new.
   */
  let changeBaseline: { runId: string; text: string } | undefined
  /**
   * What each requirement's own verified page change was surrounded by: the
   * page before it, and the page before the run's next applied change, once
   * there is one. Text inside that window appeared after this requirement's
   * action and before anything else the run did — the only text the reviewer
   * is told an action produced. Memory only and one run at a time, like the
   * baseline; a restart loses it and the reviewer is told nothing.
   *
   * `latest` is the requirement whose window the run's last applied change
   * opened or extended; `actions` is everything applied inside one window,
   * in order, so a click and the confirm it raised stay together.
   */
  let actionWindows:
    | {
        runId: string
        latest?: string
        byRequirement: Map<
          string,
          {
            before: string
            after?: string
            actions: Omit<AgentReviewedAction, "requirementId">[]
          }
        >
      }
    | undefined
  const noProgressCounts = new Map<string, number>()
  const refusedCommandCounts = new Map<string, number>()
  /** Pages a run was already told it would leave an answer on. */
  const warnedSightings = new Set<string>()
  const refusedCompletions = new Map<
    string,
    { reason: string; count: number }
  >()
  /**
   * Review requests per run. Not cleared by a correction or an answer, unlike
   * the refusal counters beside it: this is a cost ceiling, and a user
   * replying to a question has not refunded the calls already made.
   */
  const reviewsByRun = new Map<string, number>()
  /**
   * A reviewer's answers this run already holds, by what it was shown. Asked
   * again over unchanged evidence, a second model call may answer the other
   * way and send the run round a refusal it had already settled; the first
   * reading stands until the evidence it read changes.
   */
  const reviewVerdictsByRun = new Map<
    string,
    Map<string, { answer: unknown; sourceKeys: ReadonlyMap<string, string> }>
  >()
  /**
   * Ids whose latest review verdict was contradicted. Once the budget is
   * spent, one of these still awaiting review must not settle as merely
   * unreviewed: the last reading anyone gave it said it was not met.
   */
  const contradictedByRun = new Map<string, Set<string>>()
  /**
   * The contradicted ids waiting for the next receipt to carry them, written
   * there as a snapshot: the receipt that records a review's cost records
   * what it found contradicted, so neither survives a restart without the
   * other.
   */
  const pendingContradicted = new Map<string, string[]>()
  /** Consecutive failed plan amendments, and when the next one may run. */
  const planFailures = new Map<
    string,
    NonNullable<AgentStallState["planFailures"]>
  >()
  /** Runs whose counters were read back from the checkpoint, or reset since. */
  const stallRestored = new Set<string>()
  /**
   * The malformed count the checkpoint held when this worker took the run.
   * The model port counts on from it, but reports nothing until the run's
   * next malformed answer, and the checkpoint must not lose it meanwhile.
   */
  const malformedRestored = new Map<string, number>()

  /**
   * Counters a worker restart would otherwise lose, read back from the
   * checkpoint once per run per worker. A reset marks the run restored, so a
   * correction is not undone by the checkpoint it has not been written to yet.
   */
  const restoreStall = (state: AgentRunState): void => {
    if (stallRestored.has(state.id)) return
    stallRestored.add(state.id)
    const stall = state.stall
    if (!stall) return
    if (stall.noProgress !== undefined)
      noProgressCounts.set(state.id, stall.noProgress)
    if (stall.refusedCommands !== undefined)
      refusedCommandCounts.set(state.id, stall.refusedCommands)
    if (stall.refusedCompletion)
      refusedCompletions.set(state.id, { ...stall.refusedCompletion })
    if (stall.planFailures) planFailures.set(state.id, stall.planFailures)
    if (stall.malformed) malformedRestored.set(state.id, stall.malformed)
    if (stall.recent?.length) {
      const points = stall.recent.map((point) => ({
        ...point,
        url: point.url.startsWith("url:")
          ? point.url
          : hashAgentProgressUrl(point.url)
      }))
      recentProgress.set(state.id, points)
      const last = points.at(-1)
      if (last) previousProgress.set(state.id, last)
    }
  }

  /**
   * What a correction, an answer or a steer resets: the loop and refusal
   * counts. The planner's failures and the malformed count stay. A newer
   * answer already lifts the planner's backoff, since a failure is compared
   * against the answer it was made under, and the malformed budget is
   * run-wide on purpose, like the port's own count.
   */
  const forgetStall = (state: AgentRunState): void => {
    /**
     * Restored first: a correction after a restart must keep the malformed
     * count and planner failures the checkpoint holds, not mark the run
     * restored with nothing loaded.
     */
    restoreStall(state)
    const runId = state.id
    previousProgress.delete(runId)
    recentProgress.delete(runId)
    factsSeen.delete(runId)
    noProgressCounts.delete(runId)
    refusedCommandCounts.delete(runId)
    refusedCompletions.delete(runId)
    /**
     * The user's answer is a newer reading than the reviewer's. Kept as an
     * empty set rather than dropped, so the receipts written before it are
     * not read back in its place, and recorded on the next receipt.
     */
    contradictedByRun.set(runId, new Set())
    reviewVerdictsByRun.delete(runId)
    pendingContradicted.set(runId, [])
  }

  /**
   * A contradicted set kept to the plan the run holds now: an id a plan
   * amendment removed is no longer anything a review could dispute, and left
   * in, the set could outgrow what a receipt may record and fail the step
   * write that carries it. Pruned in place, and returned for chaining.
   */
  const planContradictions = (
    state: AgentRunState,
    contradicted: Set<string> | undefined
  ): Set<string> | undefined => {
    if (!contradicted) return undefined
    const planned = new Set([
      ...(state.requirements ?? []).map((requirement) => requirement.id),
      ...(state.constraints ?? []).map((constraint) => constraint.id)
    ])
    for (const id of contradicted) if (!planned.has(id)) contradicted.delete(id)
    return contradicted
  }

  const stallOf = (runId: string): AgentStallState | undefined => {
    const noProgress = noProgressCounts.get(runId)
    const refusedCommands = refusedCommandCounts.get(runId)
    const refusedCompletion = refusedCompletions.get(runId)
    const malformed =
      dependencies.model.malformedResponses?.(runId) ??
      malformedRestored.get(runId)
    const failures = planFailures.get(runId)
    const recent = (recentProgress.get(runId) ?? []).flatMap((point) => {
      const fingerprint =
        point.fingerprint ??
        (point.decision ? agentDecisionFingerprint(point.decision) : undefined)
      if (fingerprint === undefined) return []
      return [
        {
          url: point.url.startsWith("url:")
            ? point.url
            : hashAgentProgressUrl(point.url),
          snapshotHash: point.snapshotHash,
          fingerprint,
          ...(point.changeSignature
            ? { changeSignature: point.changeSignature }
            : {})
        }
      ]
    })
    const stall: AgentStallState = {
      ...(noProgress ? { noProgress } : {}),
      ...(refusedCommands ? { refusedCommands } : {}),
      ...(refusedCompletion ? { refusedCompletion } : {}),
      ...(malformed ? { malformed } : {}),
      ...(failures ? { planFailures: failures } : {}),
      ...(recent.length ? { recent } : {})
    }
    return Object.keys(stall).length ? stall : undefined
  }

  /**
   * Every durable write carries the counters as they stand, when they moved.
   * A patch that names `stall` itself is left alone.
   */
  const withStall = (
    state: AgentRunState,
    patch: AgentStatePatch | undefined
  ): AgentStatePatch | undefined => {
    if (patch && "stall" in patch) return patch
    restoreStall(state)
    const stall = stallOf(state.id)
    if (JSON.stringify(stall) === JSON.stringify(state.stall)) return patch
    return { ...patch, stall }
  }

  const claim = async (
    state: AgentRunState,
    phase: AgentRunStatus,
    patch?: AgentStatePatch,
    expected: readonly AgentRunStatus[] = AGENT_STATUS_PREDECESSORS[phase]
  ): Promise<AgentRunState | undefined> => {
    const result = await dependencies.persistence.claim({
      runId: state.id,
      phase,
      expected,
      patch: withStall(state, patch)
    })
    return result.claimed ? result.state : undefined
  }

  const transition = async (
    state: AgentRunState,
    to: AgentRunStatus,
    patch?: AgentStatePatch
  ): Promise<AgentRunState | undefined> => {
    const result = await dependencies.persistence.transition({
      runId: state.id,
      from: state.status,
      to,
      patch: withStall(state, patch)
    })
    if (!result.transitioned) return undefined
    if (isTerminalAgentStatus(result.state.status)) {
      clearBoundRequirement(state.id)
      reviewsByRun.delete(state.id)
      reviewVerdictsByRun.delete(state.id)
      contradictedByRun.delete(state.id)
      pendingContradicted.delete(state.id)
    }
    return result.state
  }

  const pause = async (
    state: AgentRunState,
    reason: AgentPauseReason,
    extra: AgentStatePatch = {}
  ): Promise<AgentRunState | undefined> => {
    /**
     * A decision that pauses writes no receipt, so its tokens would wait in
     * `pendingTelemetry` where the ceiling cannot see them across a resume or
     * a worker restart. They move onto the run here and leave the pending
     * record, so the next receipt does not count them twice.
     */
    if (state.status === "paused") return state
    const spent = agentTelemetryTokens(pendingTelemetry)
    if (spent > 0)
      pendingTelemetry = withoutAgentTelemetryTokens(pendingTelemetry)
    const paused = () => ({
      ...pausePatch(reason, dependencies.clock.now()),
      ...(spent > 0
        ? { unreceiptedTokens: (state.unreceiptedTokens ?? 0) + spent }
        : {}),
      ...(state.deadline && (reason === "question" || reason === "user")
        ? {
            deadline: suspendAgentDeadlines(
              state.deadline,
              reason,
              dependencies.clock.now()
            )
          }
        : {}),
      ...extra
    })
    if (state.status === "pause_requested") {
      return transition(state, "paused", paused())
    }
    if (
      (AGENT_STATUS_PREDECESSORS.paused as readonly AgentRunStatus[]).includes(
        state.status
      )
    ) {
      return transition(state, "paused", paused())
    }
    const requested = await transition(state, "pause_requested", paused())
    return requested ? transition(requested, "paused", paused()) : undefined
  }

  /**
   * What every receipt for this effect records beyond the command itself. A
   * command holds a ref, and a ref means nothing after the next observation,
   * so without this the run could not describe a step it had taken.
   */
  const stepEvidence = (
    effect: ResolvedAgentEffect
  ): Pick<
    AgentStepWrite,
    | "target"
    | "sourceUrl"
    | "mutating"
    | "consequential"
    | "formAction"
    | "cartAddition"
  > => {
    const target = agentStepTargetFrom(effect.target)
    /**
     * Origin and path only. A receipt is durable and is read back into a
     * prompt, so a page whose URL carries a token in its query, a secret in
     * its fragment or credentials in its userinfo must not leave one behind.
     */
    const sourceUrl = effect.sourceUrl
      ? agentStepSourceUrl(effect.sourceUrl)
      : undefined
    const formAction = agentConsequentialForm(effect)
    return {
      ...(target ? { target } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      /**
       * Recorded on every receipt this step writes, not only the first: a
       * completion is judged against the last change the run applied, and a
       * step whose later receipts forgot what it was would be judged as a
       * read.
       */
      mutating: agentEffectChangesPage(effect),
      /** What a follow-up reads to learn what it must not do again. */
      consequential: agentConsequentialEffects(effect),
      ...(formAction ? { formAction } : {}),
      ...(effect.target.cartLabel === true ? { cartAddition: true } : {})
    }
  }

  /**
   * Whether a confirmed write held exactly what its requirement's check names,
   * recorded now because nothing later can tell: the receipt redacts the
   * value, and a submission may take the control off the page. A batch is
   * filed under one requirement but may set the fields of several, so every
   * other requirement whose check it held is recorded beside it.
   */
  const heldPlannedValueEvidence = (
    state: AgentRunState,
    effect: ResolvedAgentEffect,
    verification: AgentVerificationResult,
    requirementId: string | undefined
  ): Pick<AgentStepWrite, "heldPlannedValue" | "heldPlannedFor"> => {
    const targets = effect.batch?.fields.map((field) => field.target) ?? [
      effect.target
    ]
    const held = (state.requirements ?? [])
      .filter((requirement) =>
        agentWriteHeldPlannedValue(requirement, targets, verification)
      )
      .map((requirement) => requirement.id)
    const others = effect.batch ? held.filter((id) => id !== requirementId) : []
    return {
      ...(requirementId !== undefined && held.includes(requirementId)
        ? { heldPlannedValue: true }
        : {}),
      ...(others.length ? { heldPlannedFor: others } : {})
    }
  }

  const fail = async (
    state: AgentRunState,
    code: Parameters<typeof agentFailure>[0],
    message: string
  ): Promise<void> => {
    await transition(state, "failed", {
      error: agentFailure(code, message),
      updatedAt: dependencies.clock.now()
    })
  }

  /** The same, keeping whatever the layer below already named the failure. */
  const failWith = async (
    state: AgentRunState,
    error: AgentRunState["error"]
  ): Promise<void> => {
    await transition(state, "failed", {
      error,
      updatedAt: dependencies.clock.now()
    })
  }

  /** Merged rather than appended, so re-granting an origin cannot grow the list. */
  const grantsWith = (
    state: AgentRunState,
    origin: string,
    effects: readonly AgentGrantableEffect[]
  ): AgentRunState["grants"] => {
    const existing = state.grants?.find((grant) => grant.origin === origin)
    const merged = [
      ...new Set([...(existing?.effects ?? []), ...effects])
    ] as AgentGrantableEffect[]
    return [
      ...(state.grants ?? []).filter((grant) => grant.origin !== origin),
      {
        origin,
        effects: merged,
        grantedAt: dependencies.clock.now(),
        ...(existing?.searches ? { searches: true as const } : {})
      }
    ].slice(-MAX_AGENT_GRANTS)
  }

  /** Routine consent on the site an approval opened; see `executeAndVerify`. */
  const routineGrantPatch = (
    state: AgentRunState,
    origin: string | undefined
  ): Pick<AgentRunState, "grants"> | Record<string, never> =>
    origin
      ? { grants: grantsWith(state, origin, AGENT_ROUTINE_GRANT_EFFECTS) }
      : {}

  const authorize = async (
    state: AgentRunState,
    decision: Extract<
      AgentPolicyDecision,
      { type: "allow" | "granted" | "approval_required" }
    >,
    requirementId: string | undefined,
    signal: AgentCancellationController["signal"]
  ): Promise<
    | {
        state: AgentRunState
        authorization: AuthorizedAgentEffect["authorization"]
        grants?: AgentRunState["grants"]
        routineOrigin?: string
      }
    | undefined
  > => {
    const now = dependencies.clock.now()
    const deadline = beginAgentStepDeadline(
      state.deadline ?? initialAgentDeadlineState(state.createdAt),
      now
    )
    /** The plan itself, asked for before the first step it does not cover. */
    const planAsk =
      decision.type === "allow" &&
      decision.planned &&
      !planApprovedFor(state, requirementId)
        ? planApprovalRequest(state, decision.risk, requirementId, now)
        : undefined
    const planRequest = planAsk?.request
    const asked =
      decision.type === "approval_required" ? decision.request : planRequest
    const checkpoint = await claim(state, "awaiting_approval", {
      humanDecision: asked ? { kind: "approval", request: asked } : undefined,
      deadline: asked
        ? suspendAgentDeadlines(deadline, "approval", now)
        : deadline,
      updatedAt: now
    })
    if (!checkpoint) return undefined

    if (planAsk && planRequest) {
      const answer = await dependencies.approval.request(planRequest, signal)
      if (answer.type !== "approved") {
        /**
         * The plan is not approved, so nothing runs on it: consent and the
         * run's routine grants are dropped in the same write that pauses, so
         * after Resume every step asks, as the card said it would.
         */
        await pause(checkpoint, "user", {
          humanDecision: undefined,
          planConsent: undefined,
          planApproved: undefined,
          grants: undefined
        })
        return undefined
      }
      return {
        state: checkpoint,
        authorization: {
          type: "policy",
          risk: decision.risk,
          authorizedAt: dependencies.clock.now(),
          planApproved: planAsk.approved
        }
      }
    }

    if (decision.type === "allow") {
      return {
        state: checkpoint,
        authorization: {
          type: "policy",
          risk: decision.risk,
          authorizedAt: dependencies.clock.now(),
          ...(decision.browse ? { browse: true as const } : {})
        }
      }
    }

    /**
     * Recorded as a grant rather than as policy, because a step the user
     * pre-authorized and a step policy never questioned are different facts
     * and the work log has to be able to say which happened.
     */
    if (decision.type === "granted") {
      return {
        state: checkpoint,
        authorization: {
          type: "grant",
          risk: decision.risk,
          origin: decision.origin,
          authorizedAt: dependencies.clock.now()
        }
      }
    }

    const answer = await dependencies.approval.request(decision.request, signal)
    if (answer.type !== "approved") {
      /** Answered: the panel must not offer this request as still pending. */
      await pause(checkpoint, "user", { humanDecision: undefined })
      return undefined
    }
    /**
     * Written on the transition the approval already causes, because the run
     * has no status-preserving write and inventing one to record a
     * convenience would put a second way to move a run outside the state
     * machine. Only what the request offered can be granted.
     */
    const widened =
      answer.scope === "run_origin" &&
      decision.request.origin &&
      decision.request.grantable?.length
        ? grantsWith(
            checkpoint,
            decision.request.origin,
            decision.request.grantable
          )
        : undefined
    /**
     * Routine consent follows the run to the site this approval opens, and
     * only because the approval said so: the request named the site and its
     * consequence told the user clicks and typing there would not ask. It is
     * handed on rather than granted here, and written only once verification
     * confirms the tab landed there — see `executeAndVerify`.
     */
    const routineOrigin = decision.request.routineOrigin
    return {
      state: checkpoint,
      ...(widened ? { grants: widened } : {}),
      ...(routineOrigin ? { routineOrigin } : {}),
      authorization: {
        type: "approval",
        risk: decision.risk,
        approvalId: decision.request.id,
        authorizedAt: dependencies.clock.now()
      }
    }
  }

  /**
   * Built from the run's own receipts rather than from anything held in
   * memory, so a worker restart keeps it. A read that fails degrades the
   * decision instead of ending the run: acting without history is what the
   * loop did for its whole life, and is survivable; failing here is not.
   */
  const recallHistory = async (
    state: AgentRunState
  ): Promise<
    Pick<
      AgentModelInput,
      | "history"
      | "visited"
      | "previousVerification"
      | "inspection"
      | "findings"
      | "evidenceLedger"
    > & { receipts?: readonly AgentStepReadout[] }
  > => {
    try {
      const receipts = await dependencies.persistence.steps(state.id)
      const history = buildAgentHistory(receipts)
      const visited = buildAgentVisitedPages(receipts)
      const previous = previousAgentVerification(receipts)
      const inspection = currentAgentInspection(receipts)
      const findings = buildAgentFindings(receipts)
      const evidenceLedger = boundAgentEvidence([
        ...agentUserEvidence(state),
        ...buildAgentEvidenceLedger(receipts, state.allowedOrigins)
      ])
      return {
        receipts,
        ...(history.length > 0 ? { history } : {}),
        ...(visited.length > 0 ? { visited } : {}),
        ...(previous ? { previousVerification: previous } : {}),
        ...(inspection ? { inspection } : {}),
        ...(findings.length > 0 ? { findings } : {}),
        evidenceLedger
      }
    } catch (error) {
      /**
       * History is a nicety and the run continues without it, but a run that
       * lost continuity looks exactly like a model behaving badly. The reason
       * goes to the host's trace so the two can be told apart.
       */
      dependencies.trace?.(state.id, "history_unavailable", {
        reason: error instanceof Error ? error.name : typeof error
      })
      return {}
    }
  }

  /**
   * What the step in flight has cost so far, before it has a step id.
   *
   * Observation and decision both happen before a command is grounded, so
   * their measurements have nowhere to live yet. They accumulate here and the
   * next receipt written claims them — which is also what keeps a step's
   * execute and verify timings, taken after its first receipt, on the step
   * they belong to rather than on the next one.
   */
  let pendingTelemetry: AgentStepTelemetry | undefined
  const telemetryByStep = new Map<string, AgentStepTelemetry>()
  /**
   * The reasoning behind the decision just made, claimed by the next receipt
   * written — the planned step, a refusal or a declined completion — for the
   * same reason telemetry waits here: the decision has no step id yet.
   */
  let pendingThinking: string | undefined
  /**
   * The commands this worker applied, as the model sent them. Receipts are
   * stored with typed text and selected values redacted, and the completion
   * judge reads receipts — so a verified "select Blue" could never vouch for
   * "Blue is selected", and every such run was refused until it gave up.
   * Memory only, bounded, and lost with the worker: a restarted run is
   * judged on redacted receipts and refused, exactly as before.
   */
  const liveCommands = new Map<string, AgentCommand>()
  const liveCommandSizes = new Map<string, number>()
  let liveCommandChars = 0
  /**
   * The tabs each step's execution opened, by step id: `open_tab`'s own tab
   * and any a click opened. Receipts carry no tab id, and without this an
   * `open_tab` whose site redirected it could only be matched to "some tab
   * the run opened", which a later click's tab also is. Memory only and
   * bounded like `liveCommands`; a restarted run cannot use it and refuses.
   */
  const openedTabsByStep = new Map<string, number[]>()
  const rememberOpenedTabs = (
    stepId: string,
    command: AgentCommand,
    receipt: AgentExecutionReceipt
  ): void => {
    const tabs = [
      ...(command.type === "open_tab" && receipt.controlledTabId !== undefined
        ? [receipt.controlledTabId]
        : []),
      ...(receipt.openedTabIds ?? [])
    ]
    if (tabs.length === 0) return
    openedTabsByStep.set(stepId, tabs)
    if (openedTabsByStep.size > MAX_LIVE_COMMANDS) {
      const oldest = openedTabsByStep.keys().next().value
      if (oldest !== undefined) openedTabsByStep.delete(oldest)
    }
  }
  const rememberCommand = (stepId: string, command: AgentCommand): void => {
    liveCommandChars -= liveCommandSizes.get(stepId) ?? 0
    liveCommands.delete(stepId)
    liveCommands.set(stepId, command)
    const size = JSON.stringify(command).length
    liveCommandSizes.set(stepId, size)
    liveCommandChars += size
    while (
      liveCommands.size > MAX_LIVE_COMMANDS ||
      liveCommandChars > MAX_LIVE_COMMAND_CHARS
    ) {
      const oldest = liveCommands.keys().next().value
      if (oldest === undefined) break
      liveCommandChars -= liveCommandSizes.get(oldest) ?? 0
      liveCommandSizes.delete(oldest)
      liveCommands.delete(oldest)
    }
  }
  const withLiveCommands = (
    steps: readonly AgentStepReadout[] | undefined
  ): readonly AgentStepReadout[] | undefined =>
    steps?.map((step) => {
      const command = liveCommands.get(step.stepId)
      return command && step.command?.type === command.type
        ? { ...step, command }
        : step
    })
  /**
   * Corrections typed while a run works, waiting for the next decision.
   * Memory only: a correction the worker lost before a decision heard it is
   * one the user can see was not taken, because the card says when it is.
   */
  const pendingSteering = new Map<string, { text: string; at: number }[]>()

  const measure = (telemetry: AgentStepTelemetry | undefined): void => {
    pendingTelemetry = mergeAgentStepTelemetry(pendingTelemetry, telemetry)
  }

  /**
   * Timed around a phase, reporting even when it threw: a resolve that
   * refused and an execute that failed both spent the time they spent, and a
   * step measured only on its happy path would flatter every slow failure.
   */
  const timed = async <T>(
    key: "observeMs" | "resolveMs" | "executeMs" | "verifyMs" | "captureMs",
    work: () => Promise<T>
  ): Promise<T> => {
    const startedAt = dependencies.clock.now()
    try {
      return await work()
    } finally {
      measure({ [key]: dependencies.clock.now() - startedAt })
    }
  }

  /**
   * Every receipt carries the step's running total, because the panel, the
   * history and the completion judge all collapse a step's receipts to the
   * latest one — so the latest is where a complete picture has to be.
   */
  const appendStep = async (write: AgentStepWrite): Promise<void> => {
    const startedAt = dependencies.clock.now()
    const carried = mergeAgentStepTelemetry(
      telemetryByStep.get(write.stepId),
      pendingTelemetry
    )
    pendingTelemetry = undefined
    const thinking = write.thinking ?? pendingThinking
    pendingThinking = undefined
    const reviewContradicted = pendingContradicted.get(write.runId)
    pendingContradicted.delete(write.runId)
    if (carried) {
      telemetryByStep.set(write.stepId, carried)
      /** One run cannot grow this past its own step ceiling. */
      if (telemetryByStep.size > MAX_AGENT_OBSERVATION_CEILING + 5) {
        const oldest = telemetryByStep.keys().next().value
        if (oldest !== undefined) telemetryByStep.delete(oldest)
      }
    }
    if (write.command) rememberCommand(write.stepId, write.command)
    await dependencies.persistence.appendStep({
      ...write,
      ...(thinking ? { thinking } : {}),
      ...(carried ? { telemetry: carried } : {}),
      ...(reviewContradicted ? { reviewContradicted } : {})
    })
    /**
     * Charged to the step that was written, never to whatever comes next.
     *
     * A write cannot appear in the row it is writing, so this lands on the
     * same step's following receipt — a step is written two or three times,
     * and the last one carries the running total. Only the final write of a
     * step has no successor, and its own duration stays unmeasured. Absent is
     * the honest answer there; parking it in `pendingTelemetry` instead would
     * have moved it onto an unrelated later step, where it reads as that
     * step's cost.
     */
    const persisted = mergeAgentStepTelemetry(
      telemetryByStep.get(write.stepId),
      { persistMs: dependencies.clock.now() - startedAt }
    )
    if (persisted) telemetryByStep.set(write.stepId, persisted)
  }

  const decide = async (
    state: AgentRunState,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"],
    recalled: Pick<
      AgentModelInput,
      | "history"
      | "visited"
      | "previousVerification"
      | "inspection"
      | "findings"
      | "evidenceLedger"
      | "screenshot"
      | "visual"
    >
  ) => {
    let raw: unknown
    pendingThinking = undefined
    try {
      raw = await dependencies.model.decide(
        { state, observation, ...recalled },
        signal
      )
    } catch (error) {
      measure(dependencies.model.decisionTelemetry?.(state.id))
      if (error instanceof AgentMalformedDecisionError) return undefined
      throw error
    }
    /**
     * Read here rather than returned by `decide`, because the provider's own
     * usage is the only part of a step the controller cannot time itself, and
     * the answer stops being this decision's the moment another starts.
     */
    measure(dependencies.model.decisionTelemetry?.(state.id))
    pendingThinking = dependencies.model.decisionThinking?.(state.id)
    return AgentDecisionSchema.safeParse(raw).data
  }

  /**
   * The scope a `find` or `inspect` asks the page for, if the last decision was
   * one. `extract_text` keeps its own `extraction` path: it reads the document's
   * prose, not its controls, and the two answer different questions.
   */
  const agentObservationScope = (
    inspection?: AgentInspectionFocus
  ): AgentObservationScope | undefined => {
    const offset = inspection?.offset
    if (inspection?.query)
      return {
        kind: "query",
        value: inspection.query,
        ...(offset === undefined ? {} : { offset })
      }
    if (inspection?.region)
      return {
        kind: "region",
        value: inspection.region,
        ...(offset === undefined ? {} : { offset })
      }
    return undefined
  }

  const observe = async (
    state: AgentRunState,
    signal: AgentCancellationController["signal"],
    inspection?: AgentInspectionFocus
  ): Promise<AgentObservation | undefined> => {
    const scope = agentObservationScope(inspection)
    try {
      const observation = AgentObservationSchema.parse(
        await timed("observeMs", () =>
          dependencies.observation.observe(
            {
              runId: state.id,
              tabId: state.controlledTabId,
              scopedTabIds: agentTabScope(state),
              minimumGeneration: minimumGeneration.get(state.id) ?? 0,
              allowedOrigins: state.allowedOrigins,
              ...(inspection?.text
                ? {
                    extraction: {
                      offset: inspection.offset ?? 0,
                      frameId: inspection.frameId ?? 0
                    }
                  }
                : {}),
              /**
               * A `find` or an `inspect` is a question about the document, so
               * it is asked of the document. Both used to be answered by
               * re-ranking the overview's own element list, which meant a
               * control the capture never reached could not be found by
               * either — the query looked only where the answer had already
               * been ruled out.
               */
              ...(scope ? { scope } : {}),
              /**
               * Six questions in one walk rather than six decisions. The
               * walk is the expensive half of a scoped read and the round
               * trip is the expensive half of a step, so asking them
               * together is the only one of the two that scales.
               */
              ...(inspection?.queries?.length
                ? { lookup: { queries: inspection.queries } }
                : {})
            },
            signal
          )
        )
      )
      measure({ observations: 1 })
      const minimum = minimumGeneration.get(state.id) ?? 0
      if (
        observation.tabId !== state.controlledTabId ||
        observation.generation < minimum
      ) {
        await fail(state, "stale_snapshot", "The page snapshot is stale.")
        return undefined
      }
      lastGeneration.set(state.id, observation.generation)
      return observation
    } catch (error) {
      if (!signal.aborted) {
        await fail(
          state,
          "observation_failed",
          agentObservationFailureMessage(error)
        )
      }
      return undefined
    }
  }

  /**
   * The documents, per run, where a picture the model asked for came back
   * empty. `look` is withdrawn there: a page whose sensitive controls cannot
   * be masked, or that moves under every capture, answers the same way the
   * next time, and offering the command again would let a run spend its
   * budget asking. A new document is new ground and offers it again, and so
   * does any later picture of the same one landing. Only the asking is
   * withdrawn — the pictures the vision policy takes on its own still try.
   */
  const unpicturable = new Map<string, string>()

  const visualUnavailable = (
    reason: AgentVisualUnavailableReason
  ): AgentVisualAccess => ({ available: false, reason })

  /**
   * Whether this step may be pictured at all, and if not, why — in the order
   * the reasons are facts: what the model can read, whether the host can
   * capture, whether the user allowed pictures to travel, whether the user
   * turned them off, and then what this page allows. The reason travels to
   * the model, so a run told "unavailable" is told the true one rather than
   * left to infer that a text-only model has merely been unlucky.
   */
  const visualAccess = async (
    state: AgentRunState,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"]
  ): Promise<{ access: AgentVisualAccess; policy?: AgentVisionPolicy }> => {
    if (!(await dependencies.model.vision?.(state, signal)))
      return { access: visualUnavailable("model_text_only") }
    if (!dependencies.screenshot)
      return { access: visualUnavailable("no_capture_path") }
    if (
      dependencies.screenshotsPermitted &&
      !(await dependencies.screenshotsPermitted(state))
    )
      return { access: visualUnavailable("not_permitted") }
    const policy =
      (await dependencies.model.visionPolicy?.(state, signal)) ?? "always"
    if (policy === "never")
      return { access: visualUnavailable("disabled_by_user") }
    /** Native dialogs freeze the renderer; its debugger-held text is the observation. */
    if (observation.dialogs.length)
      return { access: visualUnavailable("dialog_open"), policy }
    return { access: { available: true }, policy }
  }

  /**
   * Whether this step gets a picture once one is possible: under `auto`,
   * whether this particular step warrants one.
   *
   * A capture costs an encode, a masking pass and, far the largest of the
   * three, an image prefill in the model's own window. Most steps decide from
   * text, so most of those pictures were paid for and never looked at.
   */
  const wantsPicture = (
    policy: AgentVisionPolicy,
    state: AgentRunState,
    observation: AgentObservation,
    inspection: AgentModelInput["inspection"],
    previousVerification?: AgentVerificationResult,
    history?: AgentModelInput["history"]
  ): boolean => {
    if (policy === "always") return true
    /** The strategy the run is recovering under asked for exactly this. */
    if (state.recovery?.active?.strategy === "request_vision") return true
    if (
      agentPictureWarranted({
        state,
        observation,
        ...(inspection ? { inspection } : {}),
        ...(previousVerification ? { previousVerification } : {}),
        ...(history ? { history } : {})
      })
    )
      return true
    dependencies.trace?.(state.id, "screenshot_skipped")
    return false
  }

  /**
   * Pictures the page for a model that can see, once the DOM observation is in
   * hand so the two share one identity. A capture that fails or is refused —
   * no path to the tab, a sensitive control that could not be masked — leaves
   * the decision to the DOM alone; it never fails the run, and the picture
   * lives only in the memory of this step.
   *
   * What comes back beside the picture is whether the model may ask for one,
   * which is a different answer from whether it got one: most steps carry no
   * picture and may still `look`.
   */
  const picture = async (
    state: AgentRunState,
    observation: AgentObservation,
    inspection: AgentModelInput["inspection"],
    signal: AgentCancellationController["signal"],
    previousVerification?: AgentVerificationResult,
    history?: AgentModelInput["history"]
  ): Promise<Pick<AgentModelInput, "screenshot" | "visual">> => {
    /**
     * No picture landed. A look the run asked for and did not get is withdrawn
     * for the document, and the model is told so rather than shown nothing and
     * left to ask again.
     */
    const without = (
      access: AgentVisualAccess
    ): Pick<AgentModelInput, "visual"> => {
      if (inspection?.look) unpicturable.set(state.id, observation.documentId)
      return {
        visual:
          access.available &&
          unpicturable.get(state.id) === observation.documentId
            ? visualUnavailable("capture_failed")
            : access
      }
    }
    let access: AgentVisualAccess
    let policy: AgentVisionPolicy | undefined
    try {
      ;({ access, policy } = await visualAccess(state, observation, signal))
    } catch (error) {
      if (signal.aborted) return {}
      dependencies.trace?.(state.id, "screenshot_failed", {
        reason: error instanceof Error ? error.name : typeof error
      })
      return { visual: visualUnavailable("capture_failed") }
    }
    if (!access.available) {
      if (inspection?.look)
        dependencies.trace?.(state.id, "screenshot_unavailable", {
          reason: access.reason
        })
      return { visual: access }
    }
    if (
      !wantsPicture(
        policy ?? "always",
        state,
        observation,
        inspection,
        previousVerification,
        history
      )
    )
      return without(access)
    const screenshot = await capturePicture(
      state,
      observation,
      inspection,
      signal
    )
    if (signal.aborted) return {}
    if (!screenshot) return without(access)
    unpicturable.delete(state.id)
    return { screenshot, visual: access }
  }

  /**
   * One capture, bound to the observation it was taken with. A picture of
   * another snapshot is no picture, and a capture that fails is an answer
   * rather than a run failure.
   */
  const capturePicture = async (
    state: AgentRunState,
    observation: AgentObservation,
    inspection: AgentModelInput["inspection"],
    signal: AgentCancellationController["signal"]
  ): Promise<AgentModelInput["screenshot"]> => {
    if (!dependencies.screenshot) return undefined
    try {
      const screenshot = await dependencies.screenshot.capture(
        {
          runId: state.id,
          tabId: state.controlledTabId,
          observation,
          ...(inspection?.zoom ? { zoom: inspection.zoom } : {})
        },
        signal
      )
      if (
        screenshot &&
        (screenshot.snapshotId !== observation.snapshotId ||
          screenshot.generation !== observation.generation ||
          screenshot.documentId !== observation.documentId ||
          screenshot.tabId !== observation.tabId)
      ) {
        dependencies.trace?.(state.id, "screenshot_unbound")
        return undefined
      }
      dependencies.trace?.(state.id, "screenshot", {
        captured: screenshot !== undefined,
        width: screenshot?.imageWidth,
        height: screenshot?.imageHeight,
        maskedRegions: screenshot?.maskedRegions,
        zoomed: screenshot?.zoomed
      })
      return screenshot
    } catch (error) {
      if (signal.aborted) return undefined
      dependencies.trace?.(state.id, "screenshot_failed", {
        reason: error instanceof Error ? error.name : typeof error
      })
      return undefined
    }
  }

  /**
   * A command bound to a page the run has already moved past. Nothing was
   * attempted, so the run reads the page again rather than ending; only a
   * page that keeps moving after every strategy the trigger allows ends it,
   * with the same failure it always reported.
   */
  const recoverFromStaleSnapshot = async (
    state: AgentRunState,
    message: string,
    signal: AgentCancellationController["signal"]
  ): Promise<AgentResolutionOutcome> => {
    const recovery = await recover(state, "stale_snapshot", signal)
    if (recovery.type === "recovering")
      return { type: "refused", state: recovery.state }
    if (recovery.type === "exhausted")
      await fail(state, "stale_snapshot", message)
    return { type: "stopped" }
  }

  const resolveEffect = async (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "command" }>,
    observation: AgentObservation,
    context: AgentResolutionContext,
    signal: AgentCancellationController["signal"]
  ): Promise<AgentResolutionOutcome> => {
    const { command } = decision
    if (
      command.snapshotId !== observation.snapshotId ||
      command.generation !== observation.generation
    ) {
      return recoverFromStaleSnapshot(
        state,
        "The model referenced an obsolete page snapshot.",
        signal
      )
    }

    let effect: ResolvedAgentEffect
    try {
      effect = await timed("resolveMs", () =>
        dependencies.effect.resolve(command, observation, context)
      )
    } catch (error) {
      /**
       * Nothing was done to the page, so the run has lost track of nothing —
       * calling any of this a verification failure said the opposite. But a
       * refused command and a page that went stale under it are different
       * facts, and only the first is the model's to hear about.
       *
       * Which is what this said while failing the run on the first refusal,
       * telling nobody. A model that named a control it could see but the
       * page had scrolled away got one chance, and the panel answered a
       * well-formed decision with advice about needing a larger model.
       */
      const failure = agentResolutionFailure(error)
      if (failure.code === "invalid_decision") {
        return {
          type: "refused",
          state: await refuseCommand(state, command, failure.message, signal)
        }
      }
      if (failure.code === "stale_snapshot")
        return recoverFromStaleSnapshot(state, failure.message, signal)
      await fail(state, failure.code, failure.message)
      return { type: "stopped" }
    }
    const identity = effect.snapshotIdentity
    if (
      identity.snapshotId !== observation.snapshotId ||
      identity.generation !== observation.generation ||
      identity.tabId !== observation.tabId ||
      identity.documentId !== observation.documentId
    ) {
      return recoverFromStaleSnapshot(
        state,
        "The resolved effect no longer belongs to the observed page.",
        signal
      )
    }
    return { type: "resolved", effect }
  }

  /**
   * The words this run supplied itself, for the egress rule.
   *
   * Read only when the effect has a destination, because that is the only
   * question it answers and every read is a durable one. Receipts that cannot
   * be read leave the goal and the user's answers behind — fewer words than
   * the run actually authored, so the rule stays stricter rather than looser.
   */
  const authoredWords = async (state: AgentRunState): Promise<string[]> => {
    try {
      return agentAuthoredText(
        state,
        await dependencies.persistence.steps(state.id)
      )
    } catch (error) {
      dependencies.trace?.(state.id, "authored_text_unavailable", {
        reason: error instanceof Error ? error.name : typeof error
      })
      return agentAuthoredText(state)
    }
  }

  /**
   * Whether this run already committed a consequential effect through the
   * same control. Read from its own receipts, the same list a follow-up
   * inherits, so a worker restart between the two clicks forgets nothing.
   * An unreadable history cannot prove this is the first consequential
   * effect. Treat it as a repeat so policy asks before risking duplication.
   */
  const ownEffectHistory = async (
    state: AgentRunState,
    effect: ResolvedAgentEffect
  ): Promise<"repeat" | "unknown" | "none"> => {
    if (!agentEffectIsConsequential(effect)) return "none"
    try {
      return agentRepeatsPriorEffect(
        effect,
        agentCommittedEffects(await dependencies.persistence.steps(state.id))
      )
        ? "repeat"
        : "none"
    } catch (error) {
      dependencies.trace?.(state.id, "committed_effects_unavailable", {
        reason: error instanceof Error ? error.name : typeof error
      })
      return "unknown"
    }
  }

  const handlePolicy = async (
    state: AgentRunState,
    effect: ResolvedAgentEffect,
    stepId: string,
    stepNumber: number,
    signal: AgentCancellationController["signal"],
    requirementId?: string
  ): Promise<
    | {
        state: AgentRunState
        policy: Extract<
          AgentPolicyDecision,
          { type: "allow" | "granted" | "approval_required" }
        >
        authorization: AuthorizedAgentEffect["authorization"]
        grants?: AgentRunState["grants"]
        routineOrigin?: string
      }
    | undefined
  > => {
    const authoredText = effect.destination
      ? await authoredWords(state)
      : undefined
    const ownEffect = await ownEffectHistory(state, effect)
    const policy = dependencies.policy.evaluate({
      runId: state.id,
      stepId,
      effect,
      allowedOrigins: state.allowedOrigins,
      scopedTabIds: agentTabScope(state),
      /**
       * A page shaped like an injection ends every standing consent, grants
       * included: from then on each step that would have run on one asks.
       */
      ...(state.grants?.length && !state.injectionSuspected
        ? { grants: state.grants }
        : {}),
      ...(authoredText?.length ? { authoredText } : {}),
      ...(state.previousRun &&
      agentRepeatsPriorForm(effect, state.previousRun.effects)
        ? { repeatsPriorForm: true }
        : {}),
      ...ownEffectPolicyFlags(ownEffect),
      ...(agentPlanIsReadOnly(state) && !state.injectionSuspected
        ? { browse: true }
        : {}),
      ...plannedConsentFor(state, requirementId),
      ...plannedValuesFor(state),
      now: dependencies.clock.now()
    })
    if (policy.type === "blocked") {
      await appendStep({
        runId: state.id,
        stepId,
        status: "failed",
        command: effect.command,
        ...stepEvidence(effect),
        risk: policy.risk,
        at: dependencies.clock.now()
      })
      await fail(
        state,
        "policy_blocked",
        `The resolved effect was blocked: ${policy.reason}.`
      )
      return undefined
    }
    if (policy.type === "takeover_required") {
      const now = dependencies.clock.now()
      const deadline = beginAgentStepDeadline(
        state.deadline ?? initialAgentDeadlineState(state.createdAt),
        now
      )
      const waiting = await claim(state, "awaiting_takeover", {
        humanDecision: { kind: "takeover", request: policy.request },
        deadline: suspendAgentDeadlines(deadline, "takeover", now),
        stepCount: stepNumber,
        updatedAt: now
      })
      if (!waiting) return undefined
      const answer = await dependencies.takeover.request(policy.request, signal)
      if (answer.type === "cancelled")
        await pause(waiting, "takeover", { humanDecision: undefined })
      return undefined
    }

    const authorized = await authorize(state, policy, requirementId, signal)
    if (!authorized) return undefined
    return { ...authorized, policy }
  }

  const settleExecutionFailure = async (
    state: AgentRunState,
    effect: ResolvedAgentEffect,
    risk: AuthorizedAgentEffect["authorization"]["risk"],
    stepId: string,
    error: unknown
  ): Promise<AgentRunState | undefined> => {
    if (
      error instanceof AgentEffectNotAppliedError &&
      state.status === "executing"
    ) {
      const verifying = await claim(state, "verifying", {
        updatedAt: dependencies.clock.now()
      })
      if (!verifying) return undefined
      await appendStep({
        runId: state.id,
        stepId,
        status: "failed",
        command: effect.command,
        ...stepEvidence(effect),
        risk,
        at: dependencies.clock.now(),
        verification: {
          outcome: "negative",
          evidence: {
            kind: "stale_target",
            /**
             * The page-side refusal's own cause, which is one of a closed
             * vocabulary this build composes — never page text — so it is
             * safe to record and to show the model. Flattening every refusal
             * to one sentence threw the cause away a line before it would
             * have become useful, and left two live failures undiagnosable.
             */
            summary:
              refusalCause(error) ??
              "Target changed; no browser effect was attempted",
            observedAt: dependencies.clock.now()
          }
        }
      })
      /**
       * A control or form that moved while the run was not touching it was
       * edited by someone else. The refusal is recorded and the run stops for
       * the user rather than deciding again over their changes.
       */
      if (error.outsideEdit) {
        await pause(verifying, "user")
        return undefined
      }
      return verifying
    }
    // A lost acknowledgement or verifier is not proof of non-execution.
    await pause(state, "unresolved_effect")
    return undefined
  }

  /**
   * Closes every open window at this applied change, then opens one for its
   * own requirement when the change verified. A step that only reacted, or
   * one bound to no requirement, still closes the windows before it.
   *
   * A verified change bound to the same requirement as the change right
   * before it extends that window instead: it keeps its first `before` and
   * gains the action. "Click Continue" and the accept on the confirm it
   * raised both advance one requirement; replacing the window recorded only
   * the accept, and the reviewer, told to match the recorded action against
   * "Continue is clicked", refused a run that had clicked it.
   */
  const recordActionWindow = (
    runId: string,
    effect: ResolvedAgentEffect,
    status: AgentStepWrite["status"],
    before: AgentObservation,
    requirementId: string | undefined,
    verification?: AgentVerificationResult
  ): void => {
    /**
     * A tab the run opened is an action too: "open each source in a new
     * tab" is answered by these, and a list without them asked the
     * reviewer for proof it was never shown.
     */
    if (
      (!agentEffectChangesPage(effect) && effect.command.type !== "open_tab") ||
      !isAppliedAgentStepStatus(status)
    )
      return
    if (actionWindows?.runId !== runId)
      actionWindows = { runId, byRequirement: new Map() }
    const verified = status === "verified" && requirementId !== undefined
    const extended =
      verified && actionWindows.latest === requirementId
        ? actionWindows.byRequirement.get(requirementId)
        : undefined
    const text = agentObservationHaystack(before)
    for (const window of actionWindows.byRequirement.values())
      if (window.after === undefined && window !== extended) window.after = text
    actionWindows.latest = verified ? requirementId : undefined
    if (!verified) return
    if (extended) extended.actions.push(reviewedAction(effect, verification))
    else
      actionWindows.byRequirement.set(requirementId, {
        before: text,
        actions: [reviewedAction(effect, verification)]
      })
  }

  /**
   * The verifier's answer, asked twice when the first could not say.
   *
   * An effect nobody could confirm or rule out is asked about once more
   * before the user is: the page may simply not have finished answering.
   * Evidence only — the verifier reads the page again against the same
   * before-picture, and nothing is applied a second time. Charged to the
   * run's recovery budget and written with whatever the step settles on, so
   * the human boundary is unchanged when the answer is still unknown.
   */
  /**
   * A step known not to have applied goes back to deciding. When a second
   * look is what settled it, the spent attempt is written in the claim that
   * reopens observation; otherwise the loop claims it as it always has.
   */
  const redecidingState = (
    verifying: AgentRunState,
    recoveryPatch: AgentStatePatch
  ): Promise<AgentRunState | undefined> | AgentRunState =>
    recoveryPatch.recovery
      ? claim(
          verifying,
          "observing",
          { ...recoveryPatch, updatedAt: dependencies.clock.now() },
          ["verifying"]
        )
      : verifying

  const settledVerification = async (
    verifying: AgentRunState,
    verify: () => Promise<AgentVerificationResult>,
    risk: AuthorizedAgentEffect["authorization"]["risk"],
    signal: AgentCancellationController["signal"]
  ): Promise<{
    verification: AgentVerificationResult
    action: ReturnType<typeof classifyVerificationOutcome>
    recoveryPatch: AgentStatePatch
  }> => {
    const first = await verify()
    const action = classifyVerificationOutcome(first, risk)
    if (action.type !== "pause" || action.reason !== "unresolved_effect")
      return { verification: first, action, recoveryPatch: {} }
    /**
     * Per effect, not per episode: an episode opened by a stale snapshot has
     * already tried `fresh_observation`, and must not cost this effect its
     * second look. Only the run-wide budget bounds it.
     */
    const plan = planAgentRecovery(
      verifying.recovery && { attempts: verifying.recovery.attempts },
      {
        trigger: "unresolved_effect",
        now: dependencies.clock.now(),
        visionAvailable: false
      }
    )
    if (plan.type !== "recover")
      return { verification: first, action, recoveryPatch: {} }
    /**
     * Charged to the run, not opened as a new episode over an open one: the
     * strategies an episode already tried stay tried until a page change
     * verifies or the user answers.
     */
    const recoveryPatch = {
      recovery: verifying.recovery?.active
        ? {
            attempts: plan.recovery.attempts,
            active: verifying.recovery.active
          }
        : plan.recovery
    }
    /** Spent durably before the verifier is asked again, never after. */
    const charged = await claim(
      verifying,
      "verifying",
      { ...recoveryPatch, updatedAt: dependencies.clock.now() },
      ["verifying"]
    )
    if (!charged) return { verification: first, action, recoveryPatch: {} }
    dependencies.trace?.(verifying.id, "recovery_started", {
      trigger: "unresolved_effect",
      strategy: plan.strategy,
      attempts: plan.recovery.attempts
    })
    measure({ recoveries: 1 })
    /**
     * The second look is taken after the page has had time to answer.
     * Measured live: a Save whose request took five seconds was looked at
     * twice inside four, found inconclusive both times, and the run paused
     * a moment before the site showed it saved.
     */
    if (!(await waitBeforeCompletionRead(UNRESOLVED_EFFECT_SETTLE_MS, signal)))
      return { verification: first, action, recoveryPatch: {} }
    const second = await verify()
    return {
      verification: second,
      action: classifyVerificationOutcome(second, risk),
      recoveryPatch
    }
  }

  const executeAndVerify = async (
    state: AgentRunState,
    effect: ResolvedAgentEffect,
    observation: AgentObservation,
    authorization: AuthorizedAgentEffect["authorization"],
    policy: Extract<
      AgentPolicyDecision,
      { type: "allow" | "granted" | "approval_required" }
    >,
    stepId: string,
    stepNumber: number,
    requirementId: string | undefined,
    signal: AgentCancellationController["signal"],
    grants?: AgentRunState["grants"],
    routineOrigin?: string
  ): Promise<AgentRunState | undefined> => {
    await appendStep({
      runId: state.id,
      stepId,
      status: "approved",
      command: effect.command,
      ...stepEvidence(effect),
      risk: policy.risk,
      at: dependencies.clock.now()
    })
    /**
     * Reset where a command is carried out, not where it resolves: the
     * refusals that come after resolution — a missing requirement, a repeat,
     * a limit — used to find the count already zeroed and never reached the
     * ceiling.
     */
    refusedCommandCounts.delete(state.id)
    const executing = await claim(state, "executing", {
      deadline: resumeAgentDeadlines(
        state.deadline ?? initialAgentDeadlineState(state.createdAt),
        dependencies.clock.now()
      ),
      ...allowedOriginsPatch(state, effect, authorization),
      ...(grants ? { grants } : {}),
      ...(authorization.type === "policy" && authorization.planApproved
        ? { planApproved: [...authorization.planApproved] }
        : {}),
      stepCount: stepNumber,
      updatedAt: dependencies.clock.now()
    })
    if (!executing) return undefined
    const authorizedEffect: AuthorizedAgentEffect = { ...effect, authorization }
    let failureState = executing

    try {
      const receipt = await timed("executeMs", () =>
        dependencies.effect.execute(authorizedEffect, signal)
      )
      await appendStep({
        runId: state.id,
        stepId,
        status: "executed",
        command: effect.command,
        ...stepEvidence(effect),
        risk: policy.risk,
        at: dependencies.clock.now()
      })
      const verifying = await claim(executing, "verifying", {
        updatedAt: dependencies.clock.now()
      })
      if (!verifying) return undefined
      failureState = verifying
      const verify = () =>
        timed("verifyMs", () =>
          dependencies.effect.verify(
            {
              effect: authorizedEffect,
              receipt,
              before: observation,
              allowedOrigins: executing.allowedOrigins
            },
            signal
          )
        )
      const { verification, action, recoveryPatch } = await settledVerification(
        verifying,
        verify,
        policy.risk,
        signal
      )
      /**
       * The evidence baseline is the page as it read before the *first*
       * change the run applied, and it does not move after that.
       *
       * What the staleness refusal claims is that the quoted text "was
       * already on the page before this run changed anything". Re-capturing
       * on every applied change measured something narrower — before the
       * *last* one — which is the same thing only for a run that changes one
       * thing. A run told to fill two fields and submit quotes the first
       * field's value at the end, entirely honestly, and a baseline taken
       * before the submit already contains it.
       *
       * Promoted here rather than where the command was chosen, and against
       * the status the step actually settled on: a mutating command policy
       * refused, or one that executed and then verified negative, changed
       * nothing and must not start the baseline.
       */
      if (
        agentEffectChangesPage(effect) &&
        isAppliedAgentStepStatus(action.stepStatus) &&
        changeBaseline?.runId !== state.id
      ) {
        changeBaseline = {
          runId: state.id,
          text: agentObservationHaystack(observation)
        }
      }
      recordActionWindow(
        state.id,
        effect,
        action.stepStatus,
        observation,
        requirementId,
        verification
      )
      await appendStep({
        runId: state.id,
        stepId,
        status: action.stepStatus,
        command: effect.command,
        ...stepEvidence(effect),
        ...heldPlannedValueEvidence(state, effect, verification, requirementId),
        ...(agentWriteShownBefore(effect.command, observation)
          ? { shownBeforeWrite: true }
          : {}),
        risk: policy.risk,
        verification,
        evidenceLedger: agentVerificationEvidence(
          observation,
          effect,
          verification,
          requirementId,
          stepId
        ),
        at: dependencies.clock.now()
      })
      if (action.type === "pause") {
        await pause(
          verifying,
          action.reason === "unresolved_effect" ? "unresolved_effect" : "user",
          recoveryPatch
        )
        return undefined
      }
      // Bind only a verified step whose execution receipt proves it opened
      // the dialog. A planned, approved, or merely attempted click is not its
      // opener and must not authorize a later dialog answer.
      if (receipt.dialogOpened && isAppliedAgentStepStatus(action.stepStatus)) {
        rememberBoundRequirement(state.id, requirementId, receipt.dialogOpened)
      }
      if (action.type === "redecide")
        return redecidingState(verifying, recoveryPatch)
      /**
       * A step does not clear the no-progress guard, whatever it was meant to
       * do. Clearing on every page-changing class meant any click reset it —
       * the class is what the step *intended*, not what it did — so a run
       * alternating "open Details" and "back" twenty-one times, or clicking
       * one canvas point eighteen times, never accumulated a repeat. A step
       * that really moved the run on already reads as progress: the next
       * observation hashes differently and its change differs from the last
       * one, so `classifyNoProgress` resets the count on its own.
       */
      /**
       * A confirmed step is the run on new ground, so a completion refused
       * before it was refused about a different page. Cleared for any
       * confirmed step, a read included: what the counter is for is a run
       * repeating one claim, and a step that verified is not that.
       */
      refusedCompletions.delete(state.id)
      // The write closing a confirmed step also opens the next observation, so
      // a tab the effect switched to is durably owned before this controller
      // can lose the run. Only the verifying run this step owns may be claimed:
      // a pause or cancellation that raced verification has already recorded
      // the effect as unresolved, and resurrecting it here would restart a run
      // the user stopped. A negative or ambiguous outcome never reaches here
      // and leaves the run on the tab it already controls.
      /**
       * Routine consent for the site an approval opened is written here, on
       * the confirmed step, and not when the navigation was authorized:
       * granted up front, a navigation that was refused, redirected or never
       * committed still left clicks and typing on a site the run never
       * reached pre-approved for the rest of the run.
       */
      rememberOpenedTabs(stepId, effect.command, receipt)
      return claim(
        verifying,
        "observing",
        {
          ...adoptedTabPatch(
            verifying,
            receipt.controlledTabId,
            receipt.openedTabIds
          ),
          ...routineGrantPatch(verifying, routineOrigin),
          ...recoveryAfterVerified(verifying, recoveryPatch, effect),
          updatedAt: dependencies.clock.now()
        },
        ["verifying"]
      )
    } catch (error) {
      if (signal.aborted) return undefined
      return settleExecutionFailure(
        failureState,
        effect,
        policy.risk,
        stepId,
        error
      )
    }
  }

  const rememberBoundRequirement = (
    runId: string,
    requirementId: string | undefined,
    dialogId: string | undefined
  ): void => {
    if (requirementId && dialogId) {
      lastBoundRequirement.set(runId, { requirementId, dialogId })
    }
  }

  /**
   * Answering a dialog is the second half of the step that opened it: the
   * Delete click and the "OK" on its confirm advance one requirement. Asking
   * the model to restate it refused a correct accept on a live run and spent
   * a whole decision getting it back.
   *
   * Only when the plan has a single change requirement, so the binding is not
   * a guess. A plan that gave the confirmation its own requirement needs the
   * accept bound to that one: bound to the opener's instead, the confirmation
   * was left with no receipt to vouch for it, and a live run that had done
   * everything was refused twice and paused.
   */
  const withOpenerRequirement = (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "command" }>
  ): Extract<AgentDecision, { type: "command" }> => {
    if (decision.command.type !== "handle_dialog") {
      clearBoundRequirement(state.id)
      return decision
    }
    const opener = lastBoundRequirement.get(state.id)
    clearBoundRequirement(state.id)
    if (
      decision.requirementId !== undefined ||
      state.requirements?.filter((requirement) => requirement.kind === "change")
        .length !== 1
    )
      return decision
    if (!opener || decision.command.dialogId !== opener.dialogId) {
      return decision
    }
    return { ...decision, requirementId: opener.requirementId }
  }

  /**
   * What the task contract refuses before policy is asked, as the feedback
   * the model is told, or undefined when it refuses nothing.
   *
   * While the user's newest words are unread by the planner, nothing that
   * cannot be undone runs: the answer may be the "don't" a rule missed.
   * Routine steps go on, and the run asks again at the next decision. And
   * the user's own "do not submit" binds the effect, not the wording: a
   * command whose grounded effect is a class a constraint forbids is refused,
   * so the user is never asked to approve what they already said not to do.
   */
  const refusalByTaskContract = (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "command" }>,
    effect: ResolvedAgentEffect
  ): string | undefined => {
    if (
      dependencies.model.plan &&
      agentEffectIsConsequential(effect) &&
      agentPlanNeedsReconciling(state, state.answers) !== undefined
    ) {
      dependencies.trace?.(state.id, "outstanding_answer_refused", {})
      return OUTSTANDING_EFFECT_FEEDBACK
    }
    const requirement = state.requirements?.find(
      (entry) => entry.id === decision.requirementId
    )
    if (agentEffectChangesPage(effect)) {
      const other = agentWrongRowRecord(
        effect.target,
        requirement,
        state.requirements
      )
      if (other !== undefined) {
        dependencies.trace?.(state.id, "wrong_row_refused", {
          command: decision.command.type
        })
        return wrongRowFeedback(requirement?.id ?? "", other)
      }
      const bound = agentRowOutsideScope(
        effect.target,
        requirement,
        state.constraints
      )
      if (bound !== undefined) {
        dependencies.trace?.(state.id, "outside_scope_refused", {
          command: decision.command.type
        })
        return outsideScopeFeedback(requirement?.id ?? "", bound)
      }
    }
    const broken = agentForbiddingConstraints(
      effect,
      state.constraints,
      agentRequirementRecords(requirement),
      requirement,
      state.requirements
    )
    if (broken.length === 0) return undefined
    dependencies.trace?.(state.id, "constraint_refused", {
      constraints: broken.length,
      command: decision.command.type
    })
    return agentConstraintRefusal(broken)
  }

  /**
   * The read item a step would leave behind on this page, once per page: the
   * model is told the page names it before it goes, and a second attempt to
   * leave the same document is its answer that nothing there is wanted.
   */
  const leavesUnretained = async (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "command" }>,
    observation: AgentObservation,
    effect: ResolvedAgentEffect
  ): Promise<string | undefined> => {
    /**
     * Opening another tab or switching to one leaves this page as surely as
     * navigating away: the tab stays open, but the run's next look is
     * somewhere else, and it rarely comes back to keep what it skipped.
     */
    const leaves =
      decision.command.type === "navigate" ||
      decision.command.type === "back" ||
      decision.command.type === "open_tab" ||
      (decision.command.type === "switch_tab" &&
        decision.command.tabId !== state.controlledTabId) ||
      effect.semanticEffects.includes("navigation")
    if (!leaves) return undefined
    const sighted = agentUnretainedSighting(state, observation, decision)
    const opened = sighted
      ? undefined
      : agentUnretainedSource(
          state,
          observation,
          decision,
          (await dependencies.persistence
            .steps(state.id)
            .catch(() => undefined)) ?? []
        )
    const requirementId = sighted?.requirementId ?? opened?.requirementId
    if (requirementId === undefined) return undefined
    /** By address: returning to a hub page loads a new document each time. */
    const key = `${state.id}:${observation.url}:${requirementId}`
    if (warnedSightings.has(key)) return undefined
    warnedSightings.add(key)
    dependencies.trace?.(state.id, "unretained_sighting_refused", {
      command: decision.command.type
    })
    return sighted
      ? unretainedSightingFeedback(sighted.requirementId, sighted.item)
      : opened && unretainedSourceFeedback(opened.requirementId, opened.link)
  }

  const processCommand = async (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "command" }>,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"],
    context: AgentResolutionContext
  ): Promise<AgentRunState | undefined> => {
    decision = withOpenerRequirement(state, {
      ...decision,
      command: agentCommandKeepingUserTab(decision.command, state, observation)
    })
    const resolution = await resolveEffect(
      state,
      decision,
      observation,
      context,
      signal
    )
    /** A refused command left the run alive and looking again, not stopped. */
    if (resolution.type === "refused") return resolution.state
    if (resolution.type === "stopped") return undefined
    const { effect } = resolution
    const requirements = state.requirements
    if (agentEffectChangesPage(effect) && requirements?.length) {
      const bound = requirements.some(
        (requirement) => requirement.id === decision.requirementId
      )
      if (!bound)
        return refuseCommand(
          state,
          decision.command,
          "A page-changing command must name the planned requirement it advances in requirementId.",
          signal
        )
    }
    /**
     * Before policy, so a repeat never reaches an approval prompt: a user
     * asked to approve the second submission of something the last run
     * already sent is being asked the wrong question. Refused rather than
     * failed — nothing was attempted, and the model is told why.
     */
    if (
      state.previousRun &&
      agentRepeatsPriorEffect(effect, state.previousRun.effects)
    ) {
      return refuseCommand(
        state,
        decision.command,
        REPEATED_EFFECT_FEEDBACK,
        signal
      )
    }
    /**
     * A recovering run is the one most likely to try the thing that just
     * went wrong again. Its own earlier attempt at a consequential effect is
     * refused while that attempt is confirmed or unknown — only one known not
     * to have reached the page may be tried again — and refused rather than
     * put to the user, because the recovery exists to spend the run's
     * attention before the user's.
     */
    const repeat = await recoveringRepeat(state, effect)
    if (repeat)
      return refuseCommand(
        state,
        decision.command,
        AGENT_RECOVERY_REPEAT_FEEDBACK[repeat],
        signal
      )
    if (await firstConfirmedRepeat(state, effect))
      return refuseCommand(
        state,
        decision.command,
        AGENT_CONFIRMED_REPEAT_FEEDBACK,
        signal,
        effect
      )
    if (await repeatsBeforeClaim(state, effect))
      return refuseCommand(
        state,
        decision.command,
        AGENT_REPEAT_AFTER_CLAIM_FEEDBACK,
        signal,
        effect
      )
    /** Before policy, like a repeat: see `refusalByTaskContract`. */
    const contract = refusalByTaskContract(state, decision, effect)
    if (contract)
      return refuseCommand(state, decision.command, contract, signal)
    const passed = await leavesUnretained(state, decision, observation, effect)
    if (passed) return refuseCommand(state, decision.command, passed, signal)
    /** The last point a run may stop without owing an account of an effect. */
    if (await exhaustedTimeBudget(state)) return undefined
    const stepNumber = state.stepCount + 1
    const stepId = `${state.id}:${stepNumber}`
    const prior = withLiveCommands(
      await dependencies.persistence.steps(state.id).catch(() => undefined)
    )
    const evidenceLedger = agentCommandEvidence(
      state,
      observation,
      decision,
      effect,
      prior,
      stepId
    )
    await appendStep({
      runId: state.id,
      stepId,
      status: "planned",
      command: decision.command,
      ...(decision.requirementId
        ? { requirementId: decision.requirementId }
        : {}),
      ...stepEvidence(effect),
      ...(decision.finding ? { finding: decision.finding } : {}),
      evidenceLedger,
      at: dependencies.clock.now()
    })
    const authorized = await handlePolicy(
      state,
      effect,
      stepId,
      stepNumber,
      signal,
      decision.requirementId
    )
    if (!authorized) return undefined
    return executeAndVerify(
      authorized.state,
      effect,
      observation,
      authorized.authorization,
      authorized.policy,
      stepId,
      stepNumber,
      decision.requirementId,
      signal,
      authorized.grants,
      authorized.routineOrigin
    )
  }

  /**
   * A completion is a claim about the goal, and a run that changed anything
   * has to be able to point at the page to support it. The judgement is a
   * pure rule over the run's own receipts and the observation it decided on;
   * see `completion.ts` for why pressing the right button is not the same as
   * the thing being done.
   *
   * A refusal is a safe failure — nothing was attempted, the page is
   * untouched — so it is recorded as a step and the run looks again, with the
   * reason reaching the next decision through its own history. It is not a
   * run failure: a model that has nearly finished should get the chance to
   * observe the indicator it needs, and a model that keeps claiming the same
   * thing runs out of no-progress budget like any other repetition.
   */
  /** Cancellation while waiting is a pause, never a fabricated completion. */
  const waitBeforeCompletionRead = async (
    delay: number,
    signal: AgentCancellationController["signal"]
  ) => {
    try {
      await dependencies.clock.wait?.(delay, signal)
    } catch (error) {
      if (!signal.aborted) throw error
    }
    return !signal.aborted
  }

  /** Wait only for evidence; no action that produced it is ever replayed. */
  const completionLedger = (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "complete" }>,
    steps: readonly AgentStepReadout[] | undefined,
    observation: AgentObservation,
    /** Held for this decision only; its records keep none of the image. */
    screenshot?: AgentScreenshot
  ) =>
    boundAgentEvidence(
      [
        ...buildAgentEvidenceLedger(
          [
            {
              runId: state.id,
              stepId: "retained",
              sequence: 0,
              status: "verified",
              at: 0,
              evidenceLedger: state.evidenceLedger
            },
            ...(steps ?? [])
          ],
          state.allowedOrigins,
          observation,
          state.workflow?.entries.flatMap((entry) => entry.evidenceIds)
        ),
        ...agentCompletionEvidence(
          state,
          observation,
          decision,
          steps,
          `${state.id}:answer:${state.observationCount}`,
          screenshot
        )
      ],
      state.workflow?.entries.flatMap((entry) => entry.evidenceIds)
    )

  const settleCompletion = async (
    state: AgentRunState,
    input: Parameters<typeof judgeAgentCompletion>[0],
    decision: Extract<AgentDecision, { type: "complete" }>,
    signal: AgentCancellationController["signal"]
  ) => {
    let judgement = judgeAgentCompletion(input)
    let observation = input.observation
    /**
     * A settled answer, accepted or partial, is not waited on. Re-reading the
     * page cannot turn a requirement the run itself reported it could not do
     * into one it did.
     */
    if (!dependencies.clock.wait || judgement.type !== "refused")
      return { judgement, observation }
    const delays =
      judgement.reason === "missing_evidence"
        ? [1000]
        : judgement.reason === "absent_evidence"
          ? [250, 750, 1500]
          : []
    for (const delay of delays) {
      if (!(await waitBeforeCompletionRead(delay, signal))) return undefined
      const fresh = await observe(state, signal)
      if (!fresh) return undefined
      observation = fresh
      judgement = judgeAgentCompletion({
        ...input,
        observation,
        evidenceLedger: completionLedger(
          state,
          decision,
          input.steps,
          observation
        )
      })
      if (judgement.type !== "refused") break
    }
    return { judgement, observation }
  }

  /**
   * Fixed template for a supervisor's review, carrying no page text: it must
   * never become a quotation a later completion matches against itself.
   */
  const REVIEWED_DISPOSITION_SUMMARY =
    "Supervisor reviewed the page after an interrupted step and continued. " +
    "The effect is still unverified: completing still requires quoting the current page."

  /**
   * Records the review on the recovered rows themselves.
   *
   * Only change receipts an interruption left `uncertain` with no verification
   * get one — a verifier's own ambiguous record is never overwritten, and
   * receipts that already say how they ended are left alone. The disposition
   * keeps `uncertain`, so history still shows the effect unresolved, and the
   * completion gate reads it as reviewed rather than unchecked. Appended, like
   * every lifecycle row: the uncertain receipt it supersedes stays in history.
   *
   * Reports whether the record landed. A disposition that could not be read
   * back or written leaves the run paused: resuming without it returns the
   * run to a completion that refuses it as unverified, which no read-only
   * observation afterwards can clear.
   */
  const recordReviewedDisposition = async (runId: string): Promise<boolean> => {
    let steps: readonly AgentStepReadout[]
    try {
      steps = await dependencies.persistence.steps(runId)
    } catch {
      dependencies.trace?.(runId, "completion_receipts_unreadable")
      return false
    }
    const now = dependencies.clock.now()
    const latest = new Map<string, AgentStepReadout>()
    for (const step of [...steps].sort((a, b) => a.sequence - b.sequence)) {
      latest.set(step.stepId, step)
    }
    for (const step of latest.values()) {
      if (
        step.status !== "uncertain" ||
        step.verification !== undefined ||
        !isAgentChangeReceipt(step)
      ) {
        continue
      }
      await appendStep({
        runId,
        stepId: step.stepId,
        status: "uncertain",
        ...restatedStepEvidence(step),
        at: now,
        verification: {
          outcome: "ambiguous",
          evidence: {
            kind: "resolution",
            summary: REVIEWED_DISPOSITION_SUMMARY,
            observedAt: now
          }
        }
      })
    }
    return true
  }

  /**
   * Three answers, three statuses, written out rather than defaulted.
   *
   * `partial` settles into its own terminal status, not `completed` with a
   * note, because the panel reads a status before it reads a summary. A run
   * that met nothing is a failure, not a small partial: "Partly done" over an
   * empty outcome is the same overstatement as "Completed" over a half-filled
   * form. This was a ternary once, and the third answer fell through it to
   * `completed` while typechecking cleanly.
   */
  const settleJudgedRun = async (
    state: AgentRunState,
    judgement: Exclude<AgentCompletionJudgement, { type: "refused" }>,
    summary: string,
    evidenceLedger: AgentRunState["evidenceLedger"]
  ): Promise<void> => {
    const settled =
      judgement.type === "partial"
        ? "partial"
        : judgement.type === "unmet"
          ? "failed"
          : judgement.outcome?.claimed?.length ||
              judgement.outcome?.visual?.length
            ? "completed_unverified"
            : "completed"
    const patch: AgentStatePatch = {
      result: summary,
      ...(evidenceLedger?.length ? { evidenceLedger } : {}),
      updatedAt: dependencies.clock.now()
    }
    if (judgement.outcome) patch.outcome = judgement.outcome
    if (judgement.type === "unmet") {
      patch.error = {
        code: "goal_failed",
        message: "The Agent met none of what the task asked for."
      }
    }
    await transition(state, settled, patch)
  }

  /**
   * A requirement reported unmet while the run still has steps to spend is
   * asked about once before the run settles on it.
   *
   * `partial` and `unmet` are the model's own answers, and the judge takes
   * them as given — correctly, since it cannot know a requirement was
   * possible. But a run that fixed a typo and then answered "save: not met"
   * without ever pressing Save had not found the save impossible; it had
   * stopped. Two runs settled that way with the goal one click away, and two
   * more reported failure on a page that showed it met. Asking once costs an
   * honest partial one decision; the second answer is taken as given. The
   * feedback sends the run to the page before any action: told only "do it
   * now", a live run re-pressed a menu item whose result was already shown.
   */
  /**
   * A second and last challenge for an itemized outcome whose page items are
   * still unopened: one refused tab opening is a reason to try again, not a
   * reason to settle with most of a list unread. Names the items, never page
   * text beyond the plan's own item words, and is asked once per outcome.
   */
  const secondItemChallenge = (
    state: AgentRunState,
    judgement: AgentCompletionJudgement,
    steps: readonly AgentStepReadout[] | undefined
  ): AgentCompletionJudgement => {
    if (judgement.type !== "partial" && judgement.type !== "unmet")
      return judgement
    const done = itemChallenged.get(state.id) ?? new Set<string>()
    for (const id of judgement.outcome.unmet) {
      if (done.has(id)) continue
      const requirement = state.requirements?.find((entry) => entry.id === id)
      if (requirement?.itemsFrom !== "page" || !requirement.items?.length)
        continue
      const latest = latestAgentSteps(steps ?? [])
      const pending = requirement.items.filter(
        (_item, index) =>
          !latest.some((receipt) =>
            agentReceiptOpensPageItem(receipt, requirement, index)
          )
      )
      if (pending.length === 0) continue
      done.add(id)
      itemChallenged.set(state.id, done)
      return {
        type: "refused",
        reason: "premature_unmet",
        feedback: `You reported ${id} as not met while ${pending.length} of its items have not been opened: ${pending
          .slice(0, MAX_PENDING_ITEMS_NAMED)
          .map((item) => `"${item.slice(0, 80)}"`)
          .join(
            ", "
          )}. The run still has steps left, and an earlier refusal of one command does not make the rest impossible. Issue open_tab for each of these items now, retaining what the page says as sourceQuotes, then complete again.`
      }
    }
    return judgement
  }

  const challengeEarlyUnmet = (
    state: AgentRunState,
    judgement: AgentCompletionJudgement,
    steps?: readonly AgentStepReadout[]
  ): AgentCompletionJudgement => {
    if (judgement.type !== "partial" && judgement.type !== "unmet")
      return judgement
    if (agentObservationBudget(state) - state.observationCount < 2)
      return judgement
    const asked = challengedUnmet.get(state.id) ?? new Set<string>()
    const fresh = judgement.outcome.unmet.filter((id) => !asked.has(id))
    if (fresh.length === 0) return secondItemChallenge(state, judgement, steps)
    for (const id of fresh) asked.add(id)
    challengedUnmet.set(state.id, asked)
    return {
      type: "refused",
      reason: "premature_unmet",
      feedback: prematureUnmetFeedback(fresh)
    }
  }

  /**
   * The user said something the plan has not absorbed — the amendment call
   * failed and only its limits were read by rule. The answer may have added
   * an outcome, and a run that completes before the planner has read it is
   * a run that drops it, so completion waits; the next decision asks the
   * planner again.
   */
  const outstandingAnswer = (
    state: AgentRunState
  ): Extract<AgentCompletionJudgement, { type: "refused" }> | undefined =>
    dependencies.model.plan &&
    agentPlanNeedsReconciling(state, state.answers) !== undefined
      ? {
          type: "refused",
          reason: "missing_outcomes",
          feedback: OUTSTANDING_ANSWER_FEEDBACK
        }
      : undefined

  /** When the user last answered: a recorded review older than that is stale. */
  const latestAnswerAt = (state: AgentRunState): number =>
    Math.max(0, ...(state.answers ?? []).map((answer) => answer.answeredAt))

  /**
   * A second, independent reading of a claim the judge could not decide.
   *
   * Asked only for a `needs_review` refusal that carries a scope, so a
   * deterministic failure is never put to a reviewer and a completion the
   * judge accepted never pays for one. Whatever goes wrong — no port, budget
   * spent, a thrown or malformed answer — returns the judge's own refusal
   * unchanged: an unavailable reviewer is no review, never a pass.
   *
   * `undefined` means the run was cancelled while the reviewer worked.
   */
  const reviewCompletion = async (
    state: AgentRunState,
    judgement: AgentCompletionJudgement,
    decision: Extract<AgentDecision, { type: "complete" }>,
    steps: readonly AgentStepReadout[] | undefined,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"]
  ): Promise<
    | {
        judgement: AgentCompletionJudgement
        reviewed: boolean
        /** Ids a spent budget left standing on a contradiction. */
        disputed?: readonly string[]
      }
    | undefined
  > => {
    const port = dependencies.review
    /**
     * Two kinds of question. A needs-review refusal asks whether an
     * undecided claim is met at all; an accepted completion with claimed
     * reads asks how far they are believed. Both take the same budget, the
     * same request and the same runtime checks of every verdict.
     */
    const claimedScope = agentClaimedReviewScope(judgement, state.requirements)
    const pending = agentCompletionNeedsReview(judgement)
      ? judgement
      : claimedScope
    if (!port || !pending) return { judgement, reviewed: false }
    const request = agentCompletionReviewRequest(
      state,
      pending.review,
      decision.outcomes,
      completionLedger(state, decision, steps, observation),
      actionWindows?.runId === state.id
        ? actionWindows.byRequirement
        : undefined,
      /** Unreadable receipts leave the list incomplete: no limit credit. */
      steps ? reviewedActions(steps).map(appliedReviewedAction) : undefined,
      observation,
      steps
    )
    /**
     * What the reviewer reads, not where it was read: a record's id and
     * snapshot change with every look at an unchanged page, its words and
     * the outcome they are bound to do not. The page excerpt is context only.
     */
    const recordKey = (
      record: (typeof request.evidenceLedger)[number]
    ): string =>
      JSON.stringify([
        record.kind,
        record.validity,
        record.requirementId,
        record.verificationKind,
        record.quote,
        record.destination,
        record.pageItems
      ])
    const reviewKey = JSON.stringify({
      ...request,
      page: undefined,
      openedFrom: undefined,
      appearedAfterAction: undefined,
      evidenceLedger: request.evidenceLedger.map(recordKey)
    })
    const held = reviewVerdictsByRun.get(state.id)?.get(reviewKey)
    /**
     * A held verdict cites the ids of the look it was given. Those ids are
     * translated to this look's records by content, so a supported verdict
     * still cites a record the helpers can find; a source with no current
     * counterpart is dropped, as an unknown id would be.
     */
    const currentIds = new Map(
      request.evidenceLedger.map((record) => [recordKey(record), record.id])
    )
    const heldAnswer =
      held && AgentCompletionReviewSchema.safeParse(held.answer)
    const cachedAnswer =
      held && heldAnswer?.success
        ? {
            verdicts: heldAnswer.data.verdicts.map((verdict) => ({
              ...verdict,
              sources: verdict.sources.flatMap((source) => {
                const key = held.sourceKeys.get(source)
                const id = key === undefined ? undefined : currentIds.get(key)
                return id ? [id] : []
              })
            }))
          }
        : undefined
    /**
     * The receipts are the count that survives a worker restart; memory
     * covers a review whose receipt could not be read back. The larger wins,
     * so a restart never refunds the run's ceiling.
     */
    const spent = Math.max(
      reviewsByRun.get(state.id) ?? 0,
      agentRecordedReviews(steps)
    )
    if (!cachedAnswer && spent >= MAX_AGENT_COMPLETION_REVIEWS) {
      /**
       * Only a completion that would otherwise settle: a refusal already
       * stops the run, and an id the judge has since decided is not in the
       * scope.
       */
      /**
       * Memory first: it is this worker's own reading, and a reset since
       * leaves it empty. A restarted worker reads what the receipts say.
       */
      const contradicted = planContradictions(
        state,
        contradictedByRun.get(state.id) ??
          agentRecordedContradictions(steps, latestAnswerAt(state))
      )
      const disputed =
        judgement.type === "refused" || !contradicted
          ? []
          : [
              ...pending.review.requirementIds,
              ...pending.review.constraintIds
            ].filter((id) => contradicted.has(id))
      dependencies.trace?.(state.id, "completion_review_budget_exhausted", {
        reviews: spent,
        ...(disputed.length ? { disputed: disputed.length } : {})
      })
      return disputed.length
        ? { judgement, reviewed: false, disputed }
        : { judgement, reviewed: false }
    }
    if (!cachedAnswer) reviewsByRun.set(state.id, spent + 1)
    const startedAt = dependencies.clock.now()
    let answer: unknown = cachedAnswer
    if (cachedAnswer) dependencies.trace?.(state.id, "completion_review_reused")
    else {
      try {
        answer = await port.review(state, request, signal)
      } catch {
        if (signal.aborted) return undefined
        dependencies.trace?.(state.id, "completion_review_failed")
        return { judgement, reviewed: true }
      } finally {
        measure({ reviewMs: dependencies.clock.now() - startedAt, reviews: 1 })
        measure(port.reviewTelemetry?.(state.id))
      }
    }
    if (signal.aborted) return undefined
    const parsed = AgentCompletionReviewSchema.safeParse(answer)
    if (!parsed.success) {
      dependencies.trace?.(state.id, "completion_review_malformed")
      return { judgement, reviewed: true }
    }
    if (!cachedAnswer) {
      const byKey = reviewVerdictsByRun.get(state.id) ?? new Map()
      byKey.set(reviewKey, {
        answer,
        sourceKeys: new Map(
          request.evidenceLedger.map((record) => [record.id, recordKey(record)])
        )
      })
      reviewVerdictsByRun.set(state.id, byKey)
    }
    const verdicts = agentReviewVerdictsOf(pending.review, parsed.data)
    const contradicted =
      planContradictions(
        state,
        contradictedByRun.get(state.id) ??
          agentRecordedContradictions(steps, latestAnswerAt(state))
      ) ?? new Set<string>()
    for (const id of verdicts.answered) contradicted.delete(id)
    for (const id of verdicts.contradicted) contradicted.add(id)
    /** Ids an amendment took out of the plan since are no reading of it. */
    planContradictions(state, contradicted)
    contradictedByRun.set(state.id, contradicted)
    pendingContradicted.set(state.id, [...contradicted])
    const applied =
      judgement.type === "refused"
        ? applyAgentCompletionReview(pending, request, parsed.data)
        : applyAgentClaimedReview(judgement, pending, request, parsed.data)
    const lowered = applyAgentReviewDowngrades(
      applied.judgement,
      request,
      parsed.data
    )
    const result = {
      judgement: lowered.judgement,
      disagreements: applied.disagreements + lowered.downgraded.length
    }
    if (lowered.downgraded.length)
      dependencies.trace?.(state.id, "completion_review_downgraded", {
        downgraded: lowered.downgraded.length
      })
    measure({ reviewDisagreements: result.disagreements })
    dependencies.trace?.(state.id, "completion_reviewed", {
      asked:
        pending.review.requirementIds.length +
        pending.review.constraintIds.length,
      disagreements: result.disagreements,
      outcome:
        result.judgement.type === "refused"
          ? result.judgement.reason
          : result.judgement.type
    })
    return { judgement: result.judgement, reviewed: true }
  }

  /** Fixed template: a reviewer's acceptance carries none of its own words. */
  const REVIEW_SUPPORTED_SUMMARY =
    "Independent review found grounded support for every outcome it was asked to check."
  const REVIEW_PARTLY_SUPPORTED_SUMMARY =
    "Independent review could not support every outcome it was asked to check; those stay unchecked."

  /**
   * The refusal limit is where a completion stalls, so recovery starts here:
   * the no-progress count cannot reach its own limit first, since two
   * identical refusals ask before three repeats. The user is asked only once
   * the strategy is spent.
   */
  const recoverRefusedCompletion = async (
    state: AgentRunState,
    feedback: string,
    signal: AgentCancellationController["signal"]
  ): Promise<AgentRunState | undefined> => {
    const recovery = await recover(state, "refused_completion", signal)
    if (recovery.type === "recovering") {
      refusedCompletions.delete(state.id)
      return recovery.state
    }
    if (recovery.type === "exhausted")
      await pause(state, "question", {
        question: completionQuestion(state, feedback, recovery)
      })
    return undefined
  }

  /**
   * The read-back the runtime can run for a refused save: the page the
   * change was made on, opened again in a new tab. None for a page that is
   * not plain http(s), or for a change that was a submission — reloading the
   * page a form posted to would ask the site for something else.
   */
  const readbackProbe = (
    judgement: AgentCompletionJudgement,
    observation: AgentObservation,
    steps: readonly AgentStepReadout[] | undefined
  ):
    | {
        ids: readonly string[]
        decision: Extract<AgentDecision, { type: "command" }>
      }
    | undefined => {
    if (
      judgement.type !== "refused" ||
      judgement.reason !== "readback_required" ||
      !judgement.readback?.length ||
      !steps
    )
      return undefined
    const ids = judgement.readback
    if (!/^https?:\/\//i.test(observation.url)) return undefined
    const changes = agentAppliedChanges(steps)
    const bound = changes.filter((step) =>
      ids.includes(step.requirementId ?? "")
    )
    const last = (bound.length ? bound : changes).at(-1)
    if (!last || last.consequential?.includes("submission")) return undefined
    return {
      ids,
      decision: {
        type: "command",
        requirementId: ids[0],
        command: {
          type: "open_tab",
          url: observation.url,
          snapshotId: observation.snapshotId,
          generation: observation.generation
        }
      }
    }
  }

  const processCompletion = async (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "complete" }>,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"],
    screenshot?: AgentScreenshot
  ): Promise<AgentRunState | undefined> => {
    /**
     * Receipts that cannot be read leave the judge with an unknown rather
     * than an empty history: a run that submitted a form and then lost its
     * receipts has still submitted it, and reading that as "changed nothing"
     * would let exactly the claim this gate exists to stop straight through.
     */
    let steps: readonly AgentStepReadout[] | undefined
    try {
      steps = withLiveCommands(await dependencies.persistence.steps(state.id))
    } catch {
      dependencies.trace?.(state.id, "completion_receipts_unreadable")
    }
    const unretained = steps
      ? agentUnretainedSource(state, observation, decision, steps)
      : undefined
    const unretainedKey =
      unretained && `${state.id}:${observation.url}:${unretained.requirementId}`
    if (unretained && unretainedKey && !warnedSightings.has(unretainedKey)) {
      warnedSightings.add(unretainedKey)
      dependencies.trace?.(state.id, "unretained_sighting_refused", {
        command: "complete"
      })
      const now = dependencies.clock.now()
      await appendStep({
        runId: state.id,
        stepId: `${state.id}:completion:${state.observationCount}`,
        status: "rejected",
        at: now,
        verification: {
          outcome: "negative",
          evidence: {
            kind: "completion",
            summary: unretainedAtCompletionFeedback(
              unretained.requirementId,
              unretained.link
            ),
            observedAt: now
          }
        }
      })
      return claimObserving(state, false, ["deciding"])
    }
    const baseline =
      changeBaseline?.runId === state.id ? changeBaseline.text : undefined
    const settled = await settleCompletion(
      state,
      {
        steps,
        observation,
        evidence: decision.evidence,
        summary: decision.summary,
        baselineText: baseline,
        evidenceLedger: completionLedger(
          state,
          decision,
          steps,
          observation,
          screenshot
        ),
        constraints: state.constraints,
        startedAt: state.createdAt,
        tabOpenedBy: [...openedTabsByStep.entries()]
          .filter(
            ([stepId, tabs]) =>
              stepId.startsWith(`${state.id}:`) &&
              tabs.includes(observation.tabId)
          )
          .map(([stepId]) => stepId),
        ...(state.requirements ? { requirements: state.requirements } : {}),
        ...(decision.outcomes ? { outcomes: decision.outcomes } : {})
      },
      decision,
      signal
    )
    if (!settled) return undefined
    observation = settled.observation
    const outstanding = outstandingAnswer(state)
    let judgement: AgentCompletionJudgement
    let reviewed = false
    let disputed: readonly string[] | undefined
    if (outstanding) judgement = outstanding
    else {
      let review = await reviewCompletion(
        state,
        settled.judgement,
        decision,
        steps,
        observation,
        signal
      )
      if (!review) return undefined
      /**
       * A review that settled an undecided claim can leave reads that are
       * still only claimed; they get their own pass, within the same budget,
       * rather than settling unasked beside the ones the reviewer supported.
       */
      if (
        review.reviewed &&
        settled.judgement.type === "refused" &&
        agentClaimedReviewScope(review.judgement, state.requirements)
      ) {
        const again = await reviewCompletion(
          state,
          review.judgement,
          decision,
          steps,
          observation,
          signal
        )
        if (!again) return undefined
        review = {
          judgement: again.judgement,
          reviewed: true,
          ...(again.disputed ? { disputed: again.disputed } : {})
        }
      }
      reviewed = review.reviewed
      disputed = review.disputed
      judgement = challengeEarlyUnmet(state, review.judgement, steps)
    }
    /**
     * A reviewer last called these contradicted and none is left to read
     * them again. Settling them as unchecked would report as done what the
     * only independent reading said was not, so the user is asked instead.
     */
    if (disputed?.length && judgement.type !== "refused") {
      const feedback = `Independent review last found retained evidence contradicting ${disputed.join(", ")}, and the run has no review left to read it again.`
      const now = dependencies.clock.now()
      await appendStep({
        runId: state.id,
        stepId: `${state.id}:completion:${state.observationCount}`,
        status: "rejected",
        at: now,
        verification: {
          outcome: "negative",
          evidence: { kind: "completion", summary: feedback, observedAt: now }
        }
      })
      await pause(state, "question", {
        question: completionQuestion(state, feedback, {
          attempts: 0,
          tried: []
        })
      })
      return undefined
    }
    if (judgement.type !== "refused") {
      const evidenceLedger = completionLedger(
        state,
        decision,
        steps,
        observation,
        screenshot
      )
      /**
       * A completion the reviewer settled leaves a receipt of its own, so
       * what the review cost is durable on the run it was spent on. A
       * refused one needs none: the refusal below is written either way and
       * carries the same telemetry.
       */
      if (reviewed) {
        const now = dependencies.clock.now()
        await appendStep({
          runId: state.id,
          stepId: `${state.id}:review:${state.observationCount}`,
          status: "verified",
          at: now,
          verification: {
            outcome: "confirmed",
            evidence: {
              kind: "completion",
              summary: judgement.outcome?.claimed?.length
                ? REVIEW_PARTLY_SUPPORTED_SUMMARY
                : REVIEW_SUPPORTED_SUMMARY,
              observedAt: now
            }
          }
        })
      }
      reviewsByRun.delete(state.id)
      reviewVerdictsByRun.delete(state.id)
      contradictedByRun.delete(state.id)
      await settleJudgedRun(
        state,
        judgement,
        agentRunResult(
          decision.summary,
          state.requirements,
          decision.outcomes,
          judgement.outcome?.met,
          judgement.outcome,
          (quote, requirementId) =>
            agentQuotePageLink(quote, requirementId, evidenceLedger, steps)
        ),
        evidenceLedger
      )
      return undefined
    }
    const stalled = await exhaustedNoProgressBudget(
      state,
      observation,
      decision,
      signal,
      undefined,
      "refused_completion",
      judgement.feedback
    )
    if (stalled.type === "recovering") return stalled.state
    if (stalled.type === "stopped") return undefined
    const now = dependencies.clock.now()
    const previous = refusedCompletions.get(state.id)
    const refusals =
      previous?.reason === judgement.reason ? previous.count + 1 : 1
    refusedCompletions.set(state.id, {
      reason: judgement.reason,
      count: refusals
    })
    dependencies.trace?.(state.id, "completion_refused", {
      reason: judgement.reason,
      refusals
    })
    const probe = readbackProbe(judgement, observation, steps)
    await appendStep({
      runId: state.id,
      stepId: `${state.id}:completion:${state.observationCount}`,
      status: "rejected",
      at: now,
      verification: {
        outcome: "negative",
        evidence: {
          kind: "completion",
          summary: probe
            ? agentReadbackProbeFeedback(probe.ids)
            : judgement.feedback,
          observedAt: now
        }
      }
    })
    /**
     * The runtime reads the record back itself rather than asking the model
     * to: a model told to reopen a record waited on the page it had saved
     * instead, and the save was never checked. The probe is an ordinary
     * `open_tab` of the page the change was made on, so it passes the same
     * resolver, policy, approval and verifier as one the model chose, and
     * the next completion is judged on the freshly loaded page.
     */
    if (probe) {
      dependencies.trace?.(state.id, "readback_probe", {
        outcomes: probe.ids.length
      })
      return processCommand(state, probe.decision, observation, signal, {})
    }
    /**
     * A refusal must not be able to consume the run. Looking again is the
     * right answer the first time — the indicator may simply not have
     * appeared yet — and the wrong one once the same refusal has come back
     * unchanged: nothing the run can see on its own is going to settle it, so
     * the person who set the goal is asked.
     */
    if (refusals >= MAX_CONSECUTIVE_REFUSED_COMPLETIONS) {
      const partial = honestPartial(state, judgement, decision)
      if (partial) {
        /**
         * The model reported part of the task unmet and could not prove the
         * rest. That is a partial result, not a question: what it claims met
         * settles at the claimed tier, shown as unchecked, never as done.
         */
        const evidenceLedger = completionLedger(
          state,
          decision,
          steps,
          observation,
          screenshot
        )
        dependencies.trace?.(state.id, "completion_settled_partial", {
          reason: judgement.reason
        })
        reviewsByRun.delete(state.id)
        reviewVerdictsByRun.delete(state.id)
        contradictedByRun.delete(state.id)
        refusedCompletions.delete(state.id)
        await settleJudgedRun(
          state,
          partial,
          agentRunResult(
            decision.summary,
            state.requirements,
            decision.outcomes,
            partial.outcome.met,
            partial.outcome,
            (quote, requirementId) =>
              agentQuotePageLink(quote, requirementId, evidenceLedger, steps)
          ),
          evidenceLedger
        )
        return undefined
      }
      return recoverRefusedCompletion(state, judgement.feedback, signal)
    }
    return claimObserving(state, false, ["deciding"])
  }

  /**
   * Refusals that mean the claimed-met part has no proof, as opposed to one
   * the evidence contradicts or one about the run's own conduct. Only these
   * can settle as a partial: a contradiction stays a refusal.
   */
  const UNPROVEN_REFUSALS: ReadonlySet<string> = new Set([
    "absent_evidence",
    "missing_evidence",
    "unverified_change",
    "needs_review"
  ])

  /**
   * The partial an honest completion settles as once refusals ran out: the
   * model itself reported some requirement unmet and some met, and the judge
   * refused only for want of proof of the met part. The met part is carried
   * as claimed, so it is never read as verified.
   */
  const honestPartial = (
    state: AgentRunState,
    judgement: Extract<AgentCompletionJudgement, { type: "refused" }>,
    decision: Extract<AgentDecision, { type: "complete" }>
  ): Extract<AgentCompletionJudgement, { type: "partial" }> | undefined => {
    if (!UNPROVEN_REFUSALS.has(judgement.reason)) return undefined
    const planned = new Set((state.requirements ?? []).map((entry) => entry.id))
    const outcomes = (decision.outcomes ?? []).filter((claim) =>
      planned.has(claim.id)
    )
    const met = outcomes.filter((claim) => claim.met).map((claim) => claim.id)
    const unmet = outcomes
      .filter((claim) => !claim.met)
      .map((claim) => claim.id)
    if (met.length === 0 || unmet.length === 0) return undefined
    return {
      type: "partial",
      outcome: { met, unmet, claimed: met, graded: true }
    }
  }

  /**
   * A command the resolver would not ground, recorded and handed back.
   *
   * The same shape as a declined completion, and for the same reason:
   * nothing was attempted, so the run has lost nothing and the honest move
   * is to look again with the refusal in its own history. The sentence is
   * the affordance layer's — assembled from templates and the model's own
   * ref, never from page text — so it is safe to put in the next prompt.
   */
  const refuseCommand = async (
    state: AgentRunState,
    command: AgentCommand,
    feedback: string,
    signal: AgentCancellationController["signal"],
    /**
     * The control the refused command named, when knowing it later matters:
     * its target and page only, never its classes, so the refusal is never
     * read as an effect that was applied.
     */
    effect?: ResolvedAgentEffect
  ): Promise<AgentRunState | undefined> => {
    const refusals = (refusedCommandCounts.get(state.id) ?? 0) + 1
    refusedCommandCounts.set(state.id, refusals)
    const now = dependencies.clock.now()
    dependencies.trace?.(state.id, "command_refused", { refusals })
    const refusedPoint = recentProgress.get(state.id)?.at(-1)
    if (refusedPoint) refusedPoint.refused = true
    await appendStep({
      runId: state.id,
      stepId: `${state.id}:refused:${state.observationCount}:${refusals}`,
      status: "rejected",
      command,
      ...(effect ? refusedTarget(effect) : {}),
      at: now,
      verification: {
        outcome: "negative",
        evidence: { kind: "resolution", summary: feedback, observedAt: now }
      }
    })
    if (refusals >= MAX_CONSECUTIVE_REFUSED_COMMANDS) {
      const recovery = await recover(state, "refused_commands", signal)
      if (recovery.type === "recovering") return recovery.state
      if (recovery.type === "stopped") return undefined
      await pause(state, "question", {
        question: {
          id: `${state.id}:q${state.observationCount}`,
          text: `${feedback} ${recoveryTriedText(recovery)}What should I try instead?`,
          display: [
            ...recoveryTriedDisplay(recovery),
            {
              key: "agent.question_text.commands_refused"
            }
          ],
          askedAt: dependencies.clock.now()
        }
      })
      return undefined
    }
    return claimObserving(state, false, ["deciding"])
  }

  const processDecision = async (
    state: AgentRunState,
    decision: AgentDecision,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"],
    context: AgentResolutionContext = {}
  ): Promise<AgentRunState | undefined> => {
    if (decision.type !== "command") refusedCommandCounts.delete(state.id)
    if (decision.type === "complete") {
      return processCompletion(
        state,
        decision,
        observation,
        signal,
        context.screenshot
      )
    }
    if (decision.type === "fail") {
      /** The model answered; it just cannot do this. The endpoint is fine. */
      await fail(state, "goal_failed", decision.reason)
      return undefined
    }
    if (decision.type === "ask_user") {
      /**
       * Recorded, not merely paused. `ask_user` used to pause with reason
       * `user`, which is indistinguishable from the user pausing the run: the
       * question went nowhere and nothing could answer it.
       */
      await pause(state, "question", {
        question: {
          /**
           * Keyed on the run's observation count, which only goes up and is
           * bounded by the run's own budget. Numbering from the retained
           * answers instead made every question after the tenth `q11`, and
           * since a stale answer is refused on this id alone, an old panel
           * could then answer a question it had never seen.
           */
          id: `${state.id}:q${state.observationCount}`,
          text: decision.question,
          askedAt: dependencies.clock.now()
        }
      })
      return undefined
    }
    return processCommand(state, decision, observation, signal, context)
  }

  const claimObserving = async (
    state: AgentRunState,
    resumeDeadline: boolean,
    expected?: readonly AgentRunStatus[]
  ): Promise<AgentRunState | undefined> =>
    claim(
      state,
      "observing",
      {
        ...(resumeDeadline && state.deadline
          ? {
              deadline: resumeAgentDeadlines(
                state.deadline,
                dependencies.clock.now()
              )
            }
          : {}),
        updatedAt: dependencies.clock.now()
      },
      expected
    )

  /**
   * Whether `request_vision` is a strategy this run can use: a model that
   * can see, a way to capture, and the user's leave. Any failure to find out
   * is a no, because a strategy the run cannot carry out is a wasted attempt.
   */
  const recoveryVisionAvailable = async (
    state: AgentRunState,
    signal: AgentCancellationController["signal"]
  ): Promise<boolean> => {
    if (!dependencies.screenshot) return false
    try {
      if (!(await dependencies.model.vision?.(state, signal))) return false
      if (
        dependencies.screenshotsPermitted &&
        !(await dependencies.screenshotsPermitted(state))
      )
        return false
      return (
        (await dependencies.model.visionPolicy?.(state, signal)) !== "never"
      )
    } catch {
      return false
    }
  }

  const lastEvidenceStep = async (
    state: AgentRunState
  ): Promise<number | undefined> => {
    try {
      return lastVerifiedAgentHistoryStep(
        await dependencies.persistence.steps(state.id)
      )
    } catch {
      return undefined
    }
  }

  /**
   * The next strategy from the bounded set, committed in the same claim that
   * sends the run back to observing, so the attempt is spent durably before
   * anything acts on it. A worker restart reads the spent count back from the
   * checkpoint and cannot hand a looping run a fresh budget.
   *
   * Called only from `deciding`: every trigger is a decision the run chose
   * not to carry out, so nothing was applied to the page.
   *
   * The progress and refusal memory is kept, not cleared. A decision that
   * still repeats under the new strategy has ignored it, and costs the run
   * the next strategy at once rather than three more repeats; one that
   * differs clears the count on its own.
   */
  const recover = async (
    state: AgentRunState,
    trigger: AgentRecoveryTrigger,
    signal: AgentCancellationController["signal"],
    navigationLoop = false
  ): Promise<
    | { type: "recovering"; state: AgentRunState }
    | {
        type: "exhausted"
        attempts: number
        tried: readonly AgentRecoveryStrategy[]
      }
    | { type: "stopped" }
  > => {
    const evidenceStep = await lastEvidenceStep(state)
    const plan = planAgentRecovery(state.recovery, {
      trigger,
      now: dependencies.clock.now(),
      visionAvailable: await recoveryVisionAvailable(state, signal),
      ...(navigationLoop ? { navigationLoop } : {}),
      ...(evidenceStep !== undefined ? { evidenceStep } : {})
    })
    if (signal.aborted) return { type: "stopped" }
    if (plan.type === "exhausted") {
      dependencies.trace?.(state.id, "recovery_exhausted", {
        trigger,
        attempts: plan.attempts
      })
      return plan
    }
    dependencies.trace?.(state.id, "recovery_started", {
      trigger,
      strategy: plan.strategy,
      attempts: plan.recovery.attempts
    })
    measure({ recoveries: 1 })
    const recovering = await claim(
      state,
      "observing",
      { recovery: plan.recovery, updatedAt: dependencies.clock.now() },
      ["deciding"]
    )
    return recovering
      ? { type: "recovering", state: recovering }
      : { type: "stopped" }
  }

  /**
   * What the question says the run already tried, so the user is asked
   * after the strategies rather than instead of them. Strategy names are
   * this build's vocabulary, never page text.
   */
  const recoveryTriedText = (recovery: {
    attempts: number
    tried: readonly AgentRecoveryStrategy[]
  }): string =>
    recovery.attempts === 0
      ? ""
      : `I already tried ${
          recovery.attempts === 1
            ? "one other approach"
            : `${recovery.attempts} other approaches`
        }${
          recovery.tried.length
            ? ` (${recovery.tried.map((name) => name.replaceAll("_", " ")).join(", ")})`
            : ""
        }. `

  /** The question a refused claim ends in, after whatever recovery it spent. */
  const completionQuestion = (
    state: AgentRunState,
    feedback: string,
    recovery: { attempts: number; tried: readonly AgentRecoveryStrategy[] }
  ) => ({
    id: `${state.id}:q${state.observationCount}`,
    text: `${feedback} I have reported this task finished twice and cannot support the claim. ${recoveryTriedText(recovery)}Is it done, and if not, what should I do next?`,
    display: [
      ...recoveryTriedDisplay(recovery),
      { key: "agent.question_text.completion_refused" }
    ],
    askedAt: dependencies.clock.now()
  })

  const recoveryTriedDisplay = (recovery: { attempts: number }) =>
    recovery.attempts === 0
      ? []
      : [
          {
            key: "agent.question_text.recovery_tried",
            values: { count: recovery.attempts }
          }
        ]

  /**
   * How the run's own earlier attempt at this effect settled, while a
   * recovery is open; undefined when nothing stands in its way. Receipts
   * that cannot be read cannot show the earlier attempt missed, so the
   * answer is `unknown`.
   */
  /**
   * A consequential effect this run already applied and saw confirmed, asked
   * for again, and not yet refused for: the model is told before the user is
   * asked. Unreadable receipts answer no, which leaves the repeat to policy's
   * own notice rather than to a guess.
   */
  const firstConfirmedRepeat = async (
    state: AgentRunState,
    effect: ResolvedAgentEffect
  ): Promise<boolean> => {
    if (!agentEffectIsConsequential(effect)) return false
    try {
      const steps = await dependencies.persistence.steps(state.id)
      return (
        agentOwnEffectSettlement(effect, steps) === "confirmed" &&
        !agentRepeatWasRefused(effect, steps, AGENT_CONFIRMED_REPEAT_FEEDBACK)
      )
    } catch {
      return false
    }
  }

  /**
   * Unreadable receipts allow the press: this guard adds a refusal beside
   * the ones that decide safety, and is not one of them.
   */
  const repeatsBeforeClaim = async (
    state: AgentRunState,
    effect: ResolvedAgentEffect
  ): Promise<boolean> => {
    try {
      return agentRepeatsBeforeClaim(
        effect,
        await dependencies.persistence.steps(state.id)
      )
    } catch {
      return false
    }
  }

  /** What a refusal records of its control: the target and page. */
  const refusedTarget = (
    effect: ResolvedAgentEffect
  ): Pick<AgentStepWrite, "target" | "sourceUrl"> => {
    const { target, sourceUrl } = stepEvidence(effect)
    return {
      ...(target ? { target } : {}),
      ...(sourceUrl ? { sourceUrl } : {})
    }
  }

  const recoveringRepeat = async (
    state: AgentRunState,
    effect: ResolvedAgentEffect
  ): Promise<"confirmed" | "unknown" | undefined> => {
    if (!state.recovery?.active || !agentEffectIsConsequential(effect))
      return undefined
    let settlement: ReturnType<typeof agentOwnEffectSettlement>
    try {
      settlement = agentOwnEffectSettlement(
        effect,
        await dependencies.persistence.steps(state.id)
      )
    } catch (error) {
      dependencies.trace?.(state.id, "committed_effects_unavailable", {
        reason: error instanceof Error ? error.name : typeof error
      })
      return "unknown"
    }
    return settlement === "confirmed" || settlement === "unknown"
      ? settlement
      : undefined
  }

  /** How many distinct page facts the run has held, never fewer than before. */
  const noteFactsSeen = (state: AgentRunState): number => {
    const seen = factsSeen.get(state.id) ?? new Set<string>()
    for (const record of state.evidenceLedger ?? [])
      if (
        record.kind === "observed_fact" ||
        record.kind === "visual_observation"
      )
        seen.add(record.id)
    factsSeen.set(state.id, seen)
    return seen.size
  }

  const exhaustedNoProgressBudget = async (
    state: AgentRunState,
    observation: AgentObservation,
    decision: AgentDecision,
    signal: AgentCancellationController["signal"],
    /** The picture the decision was shown; hashed, never kept. */
    picture?: string,
    trigger: AgentRecoveryTrigger = "no_progress",
    /** Why the completion was refused, when the stall is a refused claim. */
    completionFeedback?: string
  ): Promise<
    | { type: "progressing" }
    | { type: "recovering"; state: AgentRunState }
    | { type: "stopped" }
  > => {
    const changeSignature = agentTextChangeSignature(
      progressText.get(state.id),
      observation.visibleText
    )
    progressText.set(state.id, observation.visibleText)
    restoreStall(state)
    const progress: AgentProgressPoint = {
      url: hashAgentProgressUrl(observation.url),
      snapshotHash: hashAgentObservation(observation, decision, picture),
      decision,
      fingerprint: agentDecisionFingerprint(decision, observation),
      ledgerSize: noteFactsSeen(state),
      ...(changeSignature ? { changeSignature } : {})
    }
    const result = classifyNoProgress({
      previous: previousProgress.get(state.id),
      recent: recentProgress.get(state.id),
      current: progress,
      previousCount: noProgressCounts.get(state.id)
    })
    // Comparisons use fingerprints; only the last wait's kind is also read.
    // Editing text and completion evidence do not belong in this history.
    const remembered: AgentProgressPoint = {
      ...progress,
      decision:
        decision.type === "command" && decision.command.type === "wait"
          ? { type: "command", command: decision.command }
          : undefined
    }
    previousProgress.set(state.id, remembered)
    recentProgress.set(
      state.id,
      [...(recentProgress.get(state.id) ?? []), remembered].slice(
        -MAX_AGENT_PROGRESS_POINTS
      )
    )
    noProgressCounts.set(state.id, result.count)
    /**
     * A repeat, not merely a high count: a `wait` keeps the count it found,
     * and a run told to wait for a condition must not be charged a strategy
     * for doing it.
     */
    if (!result.noProgress || result.count < MAX_CONSECUTIVE_NO_PROGRESS)
      return { type: "progressing" }
    /**
     * The repeated decision is not carried out: it is the third of its kind,
     * and the run looks again under a strategy instead.
     */
    const recovery = await recover(
      state,
      trigger,
      signal,
      new Set((recentProgress.get(state.id) ?? []).map((point) => point.url))
        .size > 1
    )
    if (recovery.type !== "exhausted") return recovery
    await pause(state, "question", {
      question:
        completionFeedback === undefined
          ? {
              id: `${state.id}:q${state.observationCount}`,
              text: `${recoveryTriedText(recovery)}I am repeating actions without progress. What should I do differently? You can also stop and finish this task yourself.`,
              display: [
                ...recoveryTriedDisplay(recovery),
                { key: "agent.question_text.no_progress" }
              ],
              askedAt: dependencies.clock.now()
            }
          : completionQuestion(state, completionFeedback, recovery)
    })
    return { type: "stopped" }
  }

  /**
   * The two ceilings the product promises, which until now were recorded in
   * the checkpoint and never read: a run could pass either and keep going.
   */
  const exhaustedTimeBudget = async (
    state: AgentRunState
  ): Promise<boolean> => {
    const deadline = state.deadline
    if (!deadline) return false
    const expired = expiredAgentDeadline(deadline, dependencies.clock.now(), {
      runMs: agentRunActiveBudgetMs(state)
    })
    if (!expired) return false
    await failWith(state, {
      ...agentFailure(
        "budget_exhausted",
        expired === "run"
          ? "The Agent run exceeded its active time budget."
          : "This Agent step exceeded its active time budget."
      ),
      messageKey: AGENT_BUDGET_MESSAGE_KEYS.time
    })
    return true
  }

  /**
   * A paused run keeps what the user typed for the decision after its
   * resume; a finished one has no decision left to hear it.
   */
  const forgetUnheardSteering = async (runId: string): Promise<void> => {
    if (!pendingSteering.has(runId) || active.has(runId)) return
    const settled = await dependencies.persistence
      .load(runId)
      .catch(() => undefined)
    if (!settled || isTerminalAgentStatus(settled.status))
      pendingSteering.delete(runId)
  }

  /**
   * The deciding claim, carrying the steering it takes off the queue and any
   * amendment the user's words made to the plan, so answers and amendment
   * commit together.
   */
  const claimDeciding = async (
    state: AgentRunState,
    steering: readonly { text: string; at: number }[] | undefined,
    signal: AgentCancellationController["signal"],
    observation: AgentObservation,
    receipts: readonly AgentStepReadout[] | undefined
  ): Promise<{ state: AgentRunState; stop?: AgentTaskPlan } | undefined> => {
    const answers = steering?.length
      ? [
          ...(state.answers ?? []),
          ...steering.map((entry) => ({
            questionId: `${state.id}:steer:${entry.at}`,
            question: "User correction while the run was working",
            text: entry.text,
            answeredAt: entry.at
          }))
        ].slice(-MAX_AGENT_ANSWERS)
      : state.answers
    const amendment = await amendedPlan(state, answers, signal)
    if (signal.aborted) return undefined
    const planPatch = pageItemsPatch(state, amendment.patch, observation)
    const progress = buildAgentWorkflow(
      { ...state, ...planPatch, answers },
      receipts,
      observation
    )
    const deciding = await claim(state, "deciding", {
      ...(progress ?? { workflow: undefined }),
      observationCount: state.observationCount + 1,
      /**
       * Durable before the decision it would affect, so a worker restart
       * cannot hand the run its shortcuts back.
       */
      ...(!state.injectionSuspected && agentPageLooksInjected(observation)
        ? { injectionSuspected: true as const }
        : {}),
      ...(steering?.length ? { answers } : {}),
      /**
       * The step's clock starts with its decision. Left at the run's creation
       * until a command was authorized, planning and every refused or read
       * decision before it counted against one step, so two slow local-model
       * decisions could end a run that never exceeded its decision timeout.
       */
      deadline: beginAgentStepDeadline(
        state.deadline ?? initialAgentDeadlineState(state.createdAt),
        dependencies.clock.now()
      ),
      /**
       * A correction is the user choosing the approach, so the open recovery
       * episode is over. Its spent attempts are not refunded.
       */
      ...(steering?.length && state.recovery?.active
        ? { recovery: settledAgentRecovery(state.recovery) }
        : {}),
      ...planPatch,
      updatedAt: dependencies.clock.now()
    })
    return deciding ? { state: deciding, stop: amendment.stop } : undefined
  }

  /**
   * The plan patch the deciding claim writes: an amendment, with the page's
   * provenance kept on the items it left alone, and — on the run's first
   * look, before any step — the links a quantified outcome owes, read off
   * the starting page. In the claim's own write, so a worker restart resumes
   * with the items this look bound rather than binding them again from a
   * page the run may since have left.
   */
  const pageItemsPatch = (
    state: AgentRunState,
    patch: AgentStatePatch,
    observation: AgentObservation
  ): AgentStatePatch => {
    const amended = patch.requirements
      ? agentPageItemsCarried(state.requirements, patch.requirements)
      : undefined
    const planned = amended ?? state.requirements
    /** A page that reads as an attack writes nothing into the plan. */
    const paged =
      planned &&
      state.observationCount === 0 &&
      state.stepCount === 0 &&
      !state.injectionSuspected &&
      !agentPageLooksInjected(observation)
        ? agentPlanWithPageLinks(
            planned,
            observation,
            patch.constraints ?? state.constraints
          )
        : undefined
    if (paged)
      dependencies.trace?.(state.id, "plan_page_items", {
        items: paged.reduce(
          (sum, requirement) =>
            sum +
            (requirement.itemsFrom === "page"
              ? (requirement.items?.length ?? 0)
              : 0),
          0
        )
      })
    const requirements = paged ?? amended
    return requirements ? { ...patch, requirements } : patch
  }

  /**
   * Removals the planner proposed, put to the user by name. The list is the
   * plan's own entries, so the user is asked about what the run would stop
   * doing — not about a sentence the planner wrote. A removal the question
   * has no room to name is dropped from the question and stays in the plan:
   * a yes applies to every pending removal, so a cut list would let it
   * remove one the user never saw.
   */
  const askRemoval = async (state: AgentRunState): Promise<void> => {
    const plan = state.plan
    const pending = plan?.pending
    if (!plan || !pending) return
    const entries = [
      ...(state.requirements ?? []),
      ...(state.constraints ?? [])
    ]
    const shown: typeof pending.removals = []
    const named: string[] = []
    for (const removal of pending.removals) {
      const text =
        entries.find((candidate) => candidate.id === removal.id)?.text ??
        removal.id
      const name = removal.item
        ? `"${removal.item}" from "${text}"`
        : `"${text}"`
      if (named.length > 0 && [...named, name].join("; ").length > 1_500) break
      shown.push(removal)
      named.push(name)
    }
    const list = named.join("; ")
    dependencies.trace?.(state.id, "plan_removal_asked", {
      removals: shown.length
    })
    const them = shown.length === 1 ? "it" : "them"
    await pause(state, "question", {
      ...(shown.length < pending.removals.length
        ? { plan: { ...plan, pending: { ...pending, removals: shown } } }
        : {}),
      question: {
        id: pending.questionId,
        text: pending.lift
          ? `Your answer may mean these limits no longer apply: ${list}. Reply allow to lift ${them}; anything else keeps ${them}.`
          : `Your answer may mean this task no longer needs: ${list}. Reply yes to remove ${them}, or no to keep ${them}.`,
        display: [
          {
            key: pending.lift
              ? "agent.question_text.confirm_lift"
              : "agent.question_text.confirm_removal",
            values: { list }
          }
        ],
        askedAt: dependencies.clock.now()
      }
    })
  }

  /** Refresh legacy, unplanned recall against the document now being observed. */
  const refreshRecalledLedger = (
    ledger: AgentModelInput["evidenceLedger"],
    state: AgentRunState,
    observation: AgentObservation
  ) =>
    ledger &&
    buildAgentEvidenceLedger(
      [
        {
          runId: state.id,
          stepId: "recall",
          status: "verified",
          at: 0,
          sequence: 0,
          evidenceLedger: [...ledger]
        }
      ],
      state.allowedOrigins,
      observation
    )

  const acknowledgeSteering = (
    runId: string,
    steering: { text: string; at: number }[] | undefined
  ): void => {
    if (!steering?.length) return
    const queued = pendingSteering.get(runId) ?? []
    const later = queued.filter((entry) => !steering.includes(entry))
    if (later.length) pendingSteering.set(runId, later)
    else pendingSteering.delete(runId)
  }

  const stopAtObservedBoundary = async (
    state: AgentRunState,
    observation: AgentObservation,
    recalled: readonly AgentStepReadout[] | undefined
  ): Promise<boolean> => {
    /**
     * History may degrade to nothing; the token ceiling may not. When the
     * recall could not read receipts they are read once more, and if they
     * still cannot be, the steps this worker wrote are counted from memory —
     * a run never decides again as if it had spent nothing.
     */
    let receipts = recalled
    if (!receipts) {
      try {
        receipts = await dependencies.persistence.steps(state.id)
      } catch {
        receipts = [...telemetryByStep]
          .filter(([stepId]) => stepId.startsWith(`${state.id}:`))
          .map(([stepId, telemetry], index) => ({
            runId: state.id,
            stepId,
            sequence: index + 1,
            status: "verified" as const,
            at: 0,
            telemetry
          }))
      }
    }
    if (
      agentRunTokens(receipts) +
        (state.unreceiptedTokens ?? 0) +
        agentTelemetryTokens(pendingTelemetry) >=
      MAX_AGENT_RUN_TOKENS
    ) {
      await failWith(state, {
        ...agentFailure(
          "budget_exhausted",
          "The Agent cumulative token budget is exhausted."
        ),
        messageKey: AGENT_BUDGET_MESSAGE_KEYS.tokens
      })
      return true
    }
    if (agentObservationNeedsHuman(observation)) {
      /** Signing in or solving a challenge is the user's time, not the run's. */
      await pause(
        state,
        "takeover",
        state.deadline
          ? {
              deadline: suspendAgentDeadlines(
                state.deadline,
                "takeover",
                dependencies.clock.now()
              )
            }
          : {}
      )
      return true
    }
    return false
  }

  const decideFromObservation = async (
    deciding: AgentRunState,
    observation: AgentObservation,
    recalled: Awaited<ReturnType<typeof recallHistory>>,
    signal: AgentCancellationController["signal"],
    context: AgentResolutionContext
  ): Promise<AgentDecision | undefined> => {
    let decision: AgentDecision | undefined
    try {
      const pictured = await picture(
        deciding,
        observation,
        recalled.inspection,
        signal,
        recalled.previousVerification,
        recalled.history
      )
      if (pictured.screenshot) context.screenshot = pictured.screenshot
      decision = await decide(deciding, observation, signal, {
        ...recalled,
        ...pictured
      })
    } catch (error) {
      /**
       * The provider's own typed failure, not a sentence written over the
       * top of it. A wedged local proxy answering 503 has an i18n key and a
       * user-facing sentence of its own; replacing them told the user to
       * check a provider that was running perfectly well.
       */
      if (!signal.aborted) {
        await failWith(
          deciding,
          agentProviderFailure(
            "model_unavailable",
            error,
            "The selected model could not produce an Agent decision."
          )
        )
      }
      return undefined
    }
    if (!decision) {
      await fail(
        deciding,
        "invalid_decision",
        "The model returned too many invalid decisions."
      )
      return undefined
    }
    return decision
  }

  const observeAndDecide = async (
    state: AgentRunState,
    signal: AgentCancellationController["signal"]
  ): Promise<
    | {
        state: AgentRunState
        observation: AgentObservation
        decision: AgentDecision
        context: AgentResolutionContext
      }
    | { state: AgentRunState; recovering: true }
    | undefined
  > => {
    const { receipts, ...recalled } = await recallHistory(state)
    const observation = await observe(state, signal, recalled.inspection)
    if (!observation) return undefined
    if (await stopAtObservedBoundary(state, observation, receipts))
      return undefined
    /**
     * Taken off the queue only once the claim that records it has landed. A
     * pause or stop that wins the claim leaves the correction queued for the
     * decision after the resume, rather than accepted and then dropped.
     */
    const steering = pendingSteering.get(state.id)
    /** Reset before the claim, so the claim's own write carries it. */
    if (steering?.length) forgetStall(state)
    const claimed = await claimDeciding(
      state,
      steering,
      signal,
      observation,
      receipts
    )
    if (!claimed) return undefined
    const deciding = claimed.state
    acknowledgeSteering(state.id, steering)

    /**
     * A new instruction is new ground: the no-progress and refusal memory
     * describe the approach the user just corrected.
     */
    if (steering?.length) {
      progressText.delete(state.id)
      challengedUnmet.delete(state.id)
      itemChallenged.delete(state.id)
      clearBoundRequirement(state.id)
    }
    if (claimed.stop && (await stopsBeforePlanning(deciding, claimed.stop)))
      return undefined
    if (deciding.plan?.pending) {
      await askRemoval(deciding)
      return undefined
    }
    recalled.evidenceLedger = deciding.workflow
      ? deciding.evidenceLedger
      : refreshRecalledLedger(recalled.evidenceLedger, deciding, observation)
    const context: AgentResolutionContext = {}
    const decision = await decideFromObservation(
      deciding,
      observation,
      { ...recalled, receipts },
      signal,
      context
    )
    if (!decision) return undefined
    const stalled =
      decision.type === "complete"
        ? ({ type: "progressing" } as const)
        : await exhaustedNoProgressBudget(
            deciding,
            observation,
            decision,
            signal,
            context.screenshot?.data
          )
    if (stalled.type === "stopped") return undefined
    return stalled.type === "recovering"
      ? { state: stalled.state, recovering: true }
      : { state: deciding, observation, decision, context }
  }

  /**
   * One model call, before the run is allowed to look at the page.
   *
   * The list it produces is what the completion judge measures the run
   * against, and it is fixed here rather than asked for at the end because a
   * model deciding at the end what the task required will decide it required
   * whatever it managed to do.
   *
   * A host with no `plan` port keeps the legacy unplanned path for backwards
   * compatibility. Once a host offers planning, however, failure cannot buy
   * the run the weaker pre-requirements completion gate: malformed plans and
   * provider failures settle the run before it is allowed to observe or act.
   */
  const preparePlanningState = async (
    state: AgentRunState
  ): Promise<AgentRunState | null | undefined> => {
    if (state.requirements) return null
    /**
     * A run paused before its plan landed has no plan to resume into. It
     * plans first: resuming straight to observation is the weaker judge by
     * another door.
     */
    const unplannedPause =
      state.status === "paused" &&
      dependencies.model.plan !== undefined &&
      state.observationCount === 0 &&
      state.stepCount === 0
    if (
      state.status !== "submitted" &&
      state.status !== "planning" &&
      !unplannedPause
    )
      return null
    if (!dependencies.model.plan) {
      if (state.status === "planning") {
        await fail(
          state,
          "model_unavailable",
          "The selected model could not resume Agent task planning."
        )
        return undefined
      }
      return null
    }
    return state.status === "planning"
      ? state
      : await transition(state, "planning", {
          ...(state.status === "paused"
            ? {
                pauseReason: undefined,
                ...(state.deadline
                  ? {
                      deadline: resumeAgentDeadlines(
                        state.deadline,
                        dependencies.clock.now()
                      )
                    }
                  : {})
              }
            : {}),
          updatedAt: dependencies.clock.now()
        })
  }

  /**
   * Where an answered or corrected pause resumes to. A run that has not been
   * planned yet — its planner asked the question — goes back to planning
   * with the answer; everything else goes back to looking.
   */
  const resumedPhase = (state: AgentRunState): "planning" | "observing" =>
    !state.requirements &&
    dependencies.model.plan !== undefined &&
    state.observationCount === 0 &&
    state.stepCount === 0
      ? "planning"
      : "observing"

  const failPlanning = async (
    planning: AgentRunState,
    error: unknown
  ): Promise<void> => {
    dependencies.trace?.(planning.id, "plan_unavailable", {
      name: error instanceof Error ? error.name : typeof error
    })
    if (error instanceof AgentMalformedDecisionError) {
      await fail(
        planning,
        "invalid_decision",
        "The selected model could not produce a valid Agent task plan."
      )
      return
    }
    await failWith(
      planning,
      agentProviderFailure(
        "model_unavailable",
        error,
        "The selected model could not produce an Agent task plan."
      )
    )
  }

  /**
   * Said before anything happens to a page, which is the only time saying it
   * costs nothing. A limitation ends the run in the planner's words; a
   * question, or a goal larger than one run tracks, is asked, and the answer
   * returns the run to planning with the user's words beside the goal.
   */
  /** The English a question carries beside its display key, for the model. */
  const OVER_CAP_QUESTION = {
    outcomes: (count: number, max: number) =>
      `This task asks for ${count} separate outcomes, and one run can track ${max}. Which should this run do? The rest can follow in another.`,
    items: (count: number, max: number) =>
      `This task names ${count} rows or records, and one run can track ${max}. Which should this run do? The rest can follow in another.`,
    constraints: (count: number, max: number) =>
      `This task sets ${count} separate limits, and one run can hold ${max}. Which matter for this run?`
  } as const

  const stopsBeforePlanning = async (
    planning: AgentRunState,
    planned: AgentTaskPlan
  ): Promise<boolean> => {
    if (planned.limitation) {
      dependencies.trace?.(planning.id, "plan_limitation", {})
      await fail(planning, "goal_failed", planned.limitation)
      return true
    }
    const overCap = planned.overCap
    if (!planned.clarification && !overCap) return false
    dependencies.trace?.(planning.id, "plan_question", {
      overCap: overCap?.unit ?? "none",
      requested: overCap?.requested ?? 0
    })
    await pause(planning, "question", {
      question: {
        /**
         * By time, not by answer count: answers are capped, so a count stops
         * moving at the cap and a stale panel could answer a newer question
         * it never showed.
         */
        id: `${planning.id}:plan:${dependencies.clock.now()}`,
        askedAt: dependencies.clock.now(),
        ...(planned.clarification || !overCap
          ? { text: planned.clarification ?? "" }
          : {
              text: OVER_CAP_QUESTION[overCap.unit](
                overCap.requested,
                overCap.max
              ),
              display: [
                {
                  key: `agent.question_text.too_many_${overCap.unit}`,
                  values: { count: overCap.requested, max: overCap.max }
                }
              ]
            })
      }
    })
    return true
  }

  const planRequirements = async (
    state: AgentRunState,
    signal: AgentCancellationController["signal"]
  ): Promise<AgentRunState | undefined> => {
    const planning = await preparePlanningState(state)
    if (planning === null) return state
    if (!planning) return undefined
    const plan = dependencies.model.plan
    if (!plan) return undefined
    const startedAt = dependencies.clock.now()
    let planned: AgentTaskPlan
    try {
      planned = await plan(planning, signal)
    } catch (error) {
      if (signal.aborted) return undefined
      measure({ planMs: dependencies.clock.now() - startedAt })
      await failPlanning(planning, error)
      return undefined
    }
    measure({ planMs: dependencies.clock.now() - startedAt })
    if (signal.aborted) return undefined
    if (await stopsBeforePlanning(planning, planned)) return undefined
    if (!planned.requirements?.length) {
      await fail(
        planning,
        "invalid_decision",
        "The selected model produced an empty Agent task plan."
      )
      return undefined
    }
    dependencies.trace?.(state.id, "planned", {
      requirements: planned.requirements.length,
      constraints: planned.constraints?.length ?? 0
    })
    const observed = await transition(planning, "observing", {
      ...agentInitialPlanPatch(planning, planned, dependencies.clock.now()),
      updatedAt: dependencies.clock.now()
    })
    if (observed?.plan?.pending) {
      await askRemoval(observed)
      return undefined
    }
    return observed ?? undefined
  }

  /**
   * The user said something the plan has not absorbed: an answer, a
   * correction, a steer. One planning call, given the goal and the user's
   * words and nothing the page wrote, may amend the plan; nothing else can.
   * A failed call leaves the plan as it was — the original authorization is
   * still a valid one — and the answer still reaches the decision as a
   * userAnswer.
   */
  const amendedPlan = async (
    state: AgentRunState,
    answers: AgentRunState["answers"],
    signal: AgentCancellationController["signal"]
  ): Promise<{ patch: AgentStatePatch; stop?: AgentTaskPlan }> => {
    const plan = dependencies.model.plan
    const answeredAt = agentPlanNeedsReconciling(state, answers)
    if (!plan || answeredAt === undefined) return { patch: {} }
    restoreStall(state)
    /**
     * A planner that failed is asked again on the next observation, then
     * after a doubling number of them, not on every one: each call can spend several provider
     * attempts, and a planner that is down stays down for longer than a
     * step. A newer answer from the user is asked about at once.
     */
    const failed = planFailures.get(state.id)
    if (
      failed &&
      failed.answeredAt >= answeredAt &&
      state.observationCount < failed.retryAt
    )
      return { patch: {} }
    /** A newer answer starts its own sequence rather than inheriting one. */
    const recordFailure = () => {
      const count =
        (failed && failed.answeredAt >= answeredAt ? failed.count : 0) + 1
      planFailures.set(state.id, {
        count,
        answeredAt,
        retryAt:
          state.observationCount +
          Math.min(2 ** (count - 1), MAX_PLAN_AMENDMENT_BACKOFF)
      })
    }
    const startedAt = dependencies.clock.now()
    let amended: AgentTaskPlan
    try {
      amended = await plan({ ...state, answers }, signal)
    } catch (error) {
      measure({ planMs: dependencies.clock.now() - startedAt })
      if (signal.aborted) return { patch: {} }
      recordFailure()
      /**
       * Not reconciled: the answer may hold a prohibition, and marking it
       * absorbed when nothing absorbed it is how "don't submit" would be
       * lost. The next decision asks again.
       */
      dependencies.trace?.(state.id, "plan_amendment_unavailable", {
        name: error instanceof Error ? error.name : typeof error
      })
      return { patch: {} }
    }
    measure({ planMs: dependencies.clock.now() - startedAt })
    if (amended.provisional) recordFailure()
    else planFailures.delete(state.id)
    /** A question must keep the answer outstanding and the existing plan whole. */
    if (amended.overCap || amended.clarification || amended.limitation)
      return { patch: {}, stop: amended }
    const patch = agentAmendedPlanPatch(
      state,
      amended,
      answeredAt,
      dependencies.clock.now()
    )
    if (patch.plan && patch.plan.version !== state.plan?.version)
      dependencies.trace?.(state.id, "plan_amended", {
        version: patch.plan.version
      })
    return { patch }
  }

  /** A recovery strategy already claimed the next observation; anything else is decided. */
  const processPrepared = (
    prepared: NonNullable<Awaited<ReturnType<typeof observeAndDecide>>>,
    signal: AgentCancellationController["signal"]
  ): Promise<AgentRunState | undefined> =>
    "recovering" in prepared
      ? Promise.resolve(prepared.state)
      : processDecision(
          prepared.state,
          prepared.decision,
          prepared.observation,
          signal,
          prepared.context
        )

  const runLoop = async (
    initialState: AgentRunState,
    controller: AgentCancellationController,
    afterTakeover = false,
    resumedIntoObserving = false
  ): Promise<void> => {
    let state = initialState
    // A confirmed step already claimed the next observing phase, durably, in
    // the write that closed it; re-claiming it here would lose that CAS.
    let observingClaimed = resumedIntoObserving
    // Only the first iteration may enter from a resumed or recovered status;
    // later ones come from the step they just closed, so a pause that raced
    // that step cannot be claimed back into observation.
    let entered = false
    while (!controller.signal.aborted) {
      if (state.observationCount >= agentObservationBudget(state)) {
        await failWith(state, {
          ...agentFailure(
            "budget_exhausted",
            "The Agent observation budget is exhausted."
          ),
          messageKey: AGENT_BUDGET_MESSAGE_KEYS.steps
        })
        return
      }
      /**
       * Checked between steps, never inside one: an effect already applied
       * has to be verified before the run may stop, or the run ends still
       * owing the user an account of what it did.
       */
      if (await exhaustedTimeBudget(state)) return
      const observing = observingClaimed
        ? state
        : await claimObserving(
            state,
            afterTakeover || state.status === "paused",
            entered ? ["verifying"] : undefined
          )
      if (!observing) return
      state = observing
      observingClaimed = false
      entered = true
      const prepared = await observeAndDecide(state, controller.signal)
      if (!prepared) return
      state = prepared.state

      const next = await processPrepared(prepared, controller.signal)
      if (!next) return
      state = next
      observingClaimed = next.status === "observing"
      // Both confirmed and a provable safe negative require a fresh
      // observation and model decision; neither repeats the command here.
    }
  }

  /**
   * Ends a run the loop threw out of, so it does not sit in `deciding` with no
   * owner until the next worker restart. A run that is mid-effect, paused or
   * already stopping is left alone: `executing` and `verifying` belong to
   * startup recovery, which marks the effect uncertain, and the rest were
   * settled by whoever asked. The error text stays out of the record, since it
   * can carry what the page or the provider said.
   */
  const settleUnexpectedFailure = async (runId: string): Promise<void> => {
    try {
      const state = await dependencies.persistence.load(runId)
      if (
        !state ||
        isTerminalAgentStatus(state.status) ||
        [
          "executing",
          "verifying",
          "paused",
          "pause_requested",
          "cancelling"
        ].includes(state.status)
      )
        return
      await fail(
        state,
        "internal_error",
        "The run stopped on an unexpected error."
      )
    } catch {
      /** Best effort: the error being rethrown is the one worth reporting. */
    }
  }

  const run = async (
    runId: string,
    afterTakeover = false,
    /**
     * Set when the caller already claimed the observation phase in the same
     * write that resumed the run — an answered question does, because a
     * paused run has no status-preserving write and the answer had to ride
     * the transition that resumed it.
     */
    observingClaimed = false
  ): Promise<void> => {
    if (active.has(runId)) return

    const controller = createCancellationController()
    active.set(runId, controller)
    try {
      const state = await dependencies.persistence.load(runId)
      if (!state || isTerminalAgentStatus(state.status)) return
      if (state.pauseReason === "unresolved_effect") return
      /**
       * A question is answered, not resumed past. Ordinary resume reaching
       * here would take the run to another observation without the
       * information it explicitly asked for, leaving the question attached
       * to the run and unanswered — and `answerQuestion` is the only path
       * that clears it, so it is the only path that may continue.
       */
      if (state.pauseReason === "question" && !observingClaimed) return
      if (state.status === "awaiting_takeover" && !afterTakeover) return
      const planned = await planRequirements(state, controller.signal)
      if (!planned) return
      await runLoop(
        planned,
        controller,
        afterTakeover,
        /** The planning transition already claimed the first observation. */
        observingClaimed || planned.status === "observing"
      )
    } catch (error) {
      /**
       * An abort is a stop or a pause that whoever asked has already
       * recorded, and a parked approval or takeover rejects on it. Settling
       * that as a failure would overwrite what the user chose.
       */
      if (controller.signal.aborted) return
      await settleUnexpectedFailure(runId)
      throw error
    } finally {
      if (active.get(runId) === controller) active.delete(runId)
      await forgetUnheardSteering(runId)
      progressText.delete(runId)
      if (actionWindows?.runId === runId) actionWindows = undefined
      // Pauses keep only bounded command values needed for later result checks.
      // A terminal run has no live continuation and can release all private values.
      const settled = await dependencies.persistence
        .load(runId)
        .catch(() => undefined)
      if (settled && isTerminalAgentStatus(settled.status)) {
        if (changeBaseline?.runId === runId) changeBaseline = undefined
        for (const stepId of liveCommands.keys()) {
          if (!stepId.startsWith(`${runId}:`)) continue
          liveCommandChars -= liveCommandSizes.get(stepId) ?? 0
          liveCommandSizes.delete(stepId)
          liveCommands.delete(stepId)
        }
        for (const key of warnedSightings)
          if (key.startsWith(`${runId}:`)) warnedSightings.delete(key)
        for (const map of [openedTabsByStep, telemetryByStep])
          for (const stepId of map.keys())
            if (stepId.startsWith(`${runId}:`)) map.delete(stepId)
        for (const map of [
          lastGeneration,
          minimumGeneration,
          previousProgress,
          recentProgress,
          factsSeen,
          challengedUnmet,
          itemChallenged,
          noProgressCounts,
          refusedCommandCounts,
          refusedCompletions,
          reviewsByRun,
          reviewVerdictsByRun,
          contradictedByRun,
          pendingContradicted,
          planFailures,
          malformedRestored,
          lastBoundRequirement,
          unpicturable
        ])
          map.delete(runId)
        stallRestored.delete(runId)
      }
    }
  }

  /**
   * Commits a pause or stop against whatever status the run holds now.
   *
   * The request reads the run and compare-and-sets from what it read. The
   * loop it is stopping keeps moving in between — observing to deciding, an
   * approval landing — and a stale read then lost the race silently: the
   * stop returned without aborting anything and the run went on. A failed
   * write is reread and tried again; only a status the request can no longer
   * leave from (terminal, or already pausing or stopping) ends it quietly.
   *
   * A request that cannot land throws rather than returning as if it had:
   * the panel reports a failed command, and the user can press again. A
   * reread showing the status that was just refused proves nothing — the
   * loop can go observing, deciding and back to observing between two reads
   * — so only the attempt count bounds the retries.
   */
  const commitStop = async (
    runId: string,
    to: "pause_requested" | "cancelling",
    patchFor: (state: AgentRunState) => AgentStatePatch
  ): Promise<{ from: AgentRunState; to: AgentRunState } | undefined> => {
    for (let attempt = 0; attempt < MAX_STOP_ATTEMPTS; attempt += 1) {
      const state = await dependencies.persistence.load(runId)
      if (
        !state ||
        isTerminalAgentStatus(state.status) ||
        !isLegalAgentTransition(state.status, to)
      )
        return undefined
      const committed = await transition(state, to, patchFor(state))
      if (committed) return { from: state, to: committed }
    }
    throw new Error(`Agent ${to} could not be recorded`)
  }

  const requestPause = async (
    runId: string,
    reason: AgentPauseReason = "user"
  ): Promise<void> => {
    const requested = await commitStop(runId, "pause_requested", (state) => ({
      ...pausePatch(reason, dependencies.clock.now()),
      ...(state.deadline && reason === "user"
        ? {
            deadline: suspendAgentDeadlines(
              state.deadline,
              "user",
              dependencies.clock.now()
            )
          }
        : {})
    }))
    if (!requested) return
    active.get(runId)?.abort()
    await transition(
      requested.to,
      "paused",
      pausePatch(
        requested.from.status === "executing" ||
          requested.from.status === "verifying"
          ? "unresolved_effect"
          : reason,
        dependencies.clock.now()
      )
    )
  }

  const requestCancel = async (runId: string): Promise<void> => {
    const cancelling = await commitStop(runId, "cancelling", () => ({
      updatedAt: dependencies.clock.now()
    }))
    if (!cancelling) return
    active.get(runId)?.abort()
    await transition(cancelling.to, "cancelled", {
      updatedAt: dependencies.clock.now()
    })
  }

  const completeTakeover = async (runId: string): Promise<void> => {
    const state = await dependencies.persistence.load(runId)
    if (!state || state.status !== "awaiting_takeover") return
    minimumGeneration.set(runId, (lastGeneration.get(runId) ?? 0) + 1)
    await run(runId, true)
  }

  return {
    start: (runId) => run(runId),
    requestPause,
    async steer(runId, text) {
      const trimmed = text.trim().slice(0, MAX_AGENT_ANSWER_CHARS)
      if (!trimmed) return false
      const state = await dependencies.persistence.load(runId)
      if (
        !state ||
        isTerminalAgentStatus(state.status) ||
        state.status === "paused" ||
        !active.has(runId)
      )
        return false
      const queued = pendingSteering.get(runId) ?? []
      pendingSteering.set(
        runId,
        [...queued, { text: trimmed, at: dependencies.clock.now() }].slice(
          -MAX_QUEUED_STEERING
        )
      )
      return true
    },
    async resume(runId, correction) {
      if (!correction) return run(runId)
      const state = await dependencies.persistence.load(runId)
      if (
        !state ||
        state.status !== "paused" ||
        state.pauseReason !== "user" ||
        state.updatedAt !== correction.pausedAt
      )
        return
      /**
       * Before the transition, so the write that records the correction
       * carries the reset counters and a restart cannot bring the old ones
       * back.
       */
      forgetStall(state)
      const recorded = await transition(state, resumedPhase(state), {
        ...(state.deadline
          ? {
              deadline: resumeAgentDeadlines(
                state.deadline,
                dependencies.clock.now()
              )
            }
          : {}),
        pauseReason: undefined,
        ...settledRecoveryPatch(state),
        answers: [
          ...(state.answers ?? []),
          {
            questionId: `${state.id}:correction:${state.updatedAt}`,
            question: "User correction after pausing",
            text: correction.text.slice(0, MAX_AGENT_ANSWER_CHARS),
            answeredAt: dependencies.clock.now()
          }
        ].slice(-MAX_AGENT_ANSWERS),
        updatedAt: dependencies.clock.now()
      })
      if (!recorded) return
      progressText.delete(state.id)
      challengedUnmet.delete(state.id)
      itemChallenged.delete(state.id)
      clearBoundRequirement(state.id)
      await run(recorded.id, false, true)
    },
    async answerQuestion({ runId, questionId, text }) {
      const state = await dependencies.persistence.load(runId)
      if (
        !state ||
        state.status !== "paused" ||
        state.pauseReason !== "question" ||
        state.question?.id !== questionId
      ) {
        return
      }
      progressText.delete(state.id)
      challengedUnmet.delete(state.id)
      itemChallenged.delete(state.id)
      clearBoundRequirement(state.id)
      forgetStall(state)
      const answers = [
        ...(state.answers ?? []),
        {
          questionId,
          question: state.question.text,
          text: text.slice(0, MAX_AGENT_ANSWER_CHARS),
          answeredAt: dependencies.clock.now()
        }
      ].slice(-MAX_AGENT_ANSWERS)
      /**
       * Recorded on the transition that resumes the run, because a paused run
       * has no status-preserving write. Answer and resumption are therefore
       * one commit: a worker lost between them cannot leave an answered
       * question still waiting for its answer.
       */
      /**
       * The answer to a removal question decides those removals and nothing
       * else: a plain yes removes, anything else keeps.
       */
      const removal =
        state.plan?.pending?.questionId === questionId
          ? agentConfirmedRemovalPatch(
              state,
              text,
              dependencies.clock.now(),
              dependencies.clock.now()
            )
          : {}
      const recorded = await transition(state, resumedPhase(state), {
        ...(state.deadline
          ? {
              deadline: resumeAgentDeadlines(
                state.deadline,
                dependencies.clock.now()
              )
            }
          : {}),
        pauseReason: undefined,
        ...settledRecoveryPatch(state),
        answers,
        ...removal,
        question: undefined,
        updatedAt: dependencies.clock.now()
      })
      if (!recorded) return
      await run(recorded.id, false, true)
    },
    /**
     * The user has looked at the page and is continuing.
     *
     * Nothing is replayed and nothing is asserted about what happened: the
     * run takes a fresh observation and decides from what is on screen, which
     * is the only account of the page either of them can trust. The
     * generation is bumped the way a completed takeover bumps it, so no
     * reference bound before the page moved survives into the next decision.
     *
     * Leaving stop as the only exit was the more dangerous arrangement. A
     * stopped run is started again from the goal, and the new run carries no
     * memory that the click already landed — so refusing to continue here is
     * what made the action likely to happen twice.
     *
     * The review is also recorded, because a recovered change nobody verified
     * refuses every later completion on its own: the disposition below lifts
     * that refusal without vouching for the effect. The row keeps the
     * `uncertain` status the interruption wrote, carries a fixed template
     * rather than any page text, and still owes a quotation for every outcome
     * it served — a reviewed click is permission to continue, not proof the
     * click worked.
     */
    async resolveEffect({ runId, pausedAt }) {
      const state = await dependencies.persistence.load(runId)
      if (
        !state ||
        state.status !== "paused" ||
        state.pauseReason !== "unresolved_effect" ||
        state.updatedAt !== pausedAt
      ) {
        return
      }
      progressText.delete(state.id)
      challengedUnmet.delete(state.id)
      itemChallenged.delete(state.id)
      clearBoundRequirement(state.id)
      forgetStall(state)
      minimumGeneration.set(runId, (lastGeneration.get(runId) ?? 0) + 1)
      if (!(await recordReviewedDisposition(state.id))) return
      const recorded = await transition(state, "observing", {
        ...(state.deadline
          ? {
              deadline: resumeAgentDeadlines(
                state.deadline,
                dependencies.clock.now()
              )
            }
          : {}),
        pauseReason: undefined,
        ...settledRecoveryPatch(state),
        updatedAt: dependencies.clock.now()
      })
      if (!recorded) return
      await run(recorded.id, false, true)
    },
    async finishReviewed({ runId, pausedAt }) {
      const state = await dependencies.persistence.load(runId)
      if (
        !state ||
        state.status !== "paused" ||
        state.pauseReason !== "unresolved_effect" ||
        state.updatedAt !== pausedAt
      ) {
        return
      }
      /**
       * The same record continuing writes: the uncertain step was looked at
       * by the user, so the step history says so as the result does.
       */
      if (!(await recordReviewedDisposition(state.id))) return
      await transition(state, "completed", {
        pauseReason: undefined,
        result: AGENT_USER_CONFIRMED_RESULT,
        updatedAt: dependencies.clock.now()
      })
    },
    requestCancel,
    completeTakeover
  }
}
