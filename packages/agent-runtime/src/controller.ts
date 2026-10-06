import type {
  AgentCommand,
  AgentObservationScope
} from "@ollama-client/contracts"
import {
  AGENT_ROUTINE_GRANT_EFFECTS,
  AgentCompletionReviewSchema,
  type AgentDecision,
  AgentDecisionSchema,
  type AgentGrantableEffect,
  type AgentObservation,
  AgentObservationSchema,
  type AgentPauseReason,
  type AgentRunState,
  type AgentRunStatus,
  type AgentStepTelemetry,
  type AgentTaskPlan,
  MAX_AGENT_ALLOWED_ORIGINS,
  MAX_AGENT_ANSWER_CHARS,
  MAX_AGENT_ANSWERS,
  MAX_AGENT_GRANTS,
  MAX_AGENT_OBSERVATIONS,
  MAX_AGENT_SCOPED_TABS
} from "@ollama-client/contracts"
import {
  type AgentProgressPoint,
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
  agentEffectChangesPage,
  isAgentChangeReceipt,
  isAppliedAgentStepStatus,
  judgeAgentCompletion,
  prematureUnmetFeedback
} from "./completion"
import {
  agentCompletionNeedsReview,
  agentCompletionReviewRequest,
  agentRecordedReviews,
  applyAgentCompletionReview,
  MAX_AGENT_COMPLETION_REVIEWS
} from "./completion-review"
import { agentObservationFailureMessage } from "./control-failure"
import {
  agentCommandEvidence,
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
  currentAgentInspection,
  previousAgentVerification
} from "./history"
import { agentObservationHaystack } from "./observed-text"
import {
  agentAmendedPlanPatch,
  agentConfirmedRemovalPatch,
  agentConstraintRefusal,
  agentForbiddingConstraints,
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
  AgentPolicyDecision,
  AgentResolutionContext,
  AgentStatePatch,
  AgentStepReadout,
  AgentStepWrite,
  AgentVerificationResult,
  AuthorizedAgentEffect,
  ResolvedAgentEffect
} from "./ports"
import {
  AgentEffectNotAppliedError,
  AgentMalformedDecisionError,
  agentFailure,
  agentProviderFailure,
  pausePatch
} from "./ports"
import {
  agentCommittedEffects,
  agentConsequentialEffects,
  agentConsequentialForm,
  agentEffectIsConsequential,
  agentRepeatsPriorEffect,
  agentRepeatsPriorForm
} from "./prior-effects"
import { agentAuthoredText } from "./provenance"
import { agentResolutionFailure } from "./resolution-failure"
import { agentRunResult } from "./run-result"
import {
  AGENT_STATUS_PREDECESSORS,
  agentTabScope,
  isTerminalAgentStatus
} from "./state"
import { mergeAgentStepTelemetry } from "./telemetry"
import { agentCommandKeepingUserTab } from "./user-tab"
import { classifyVerificationOutcome } from "./verification"
import { agentPictureWarranted } from "./vision"

/**
 * The result of a run the user finished after reviewing the page. Run data
 * rather than panel copy, like every other result: the chat that delegated
 * the task reads it.
 */
const AGENT_USER_CONFIRMED_RESULT =
  "The user reviewed the page and confirmed the task is done."

/** Two runs' worth of steps: the live one and one just settled. */
const MAX_LIVE_COMMANDS = MAX_AGENT_OBSERVATIONS * 2

const MAX_CONSECUTIVE_NO_PROGRESS = 3

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

const MAX_CONSECUTIVE_REFUSED_COMMANDS = 3

/** Corrections one decision will take in at once; older ones are dropped. */
const MAX_QUEUED_STEERING = 3

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
  | "consequential"
  | "formAction"
  | "target"
  | "sourceUrl"
  | "finding"
> => ({
  ...(step.command ? { command: step.command } : {}),
  ...(step.mutating !== undefined ? { mutating: step.mutating } : {}),
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
 * it, and only in the durable write that opens execution — the same boundary
 * that owns the effect the approval authorized. A policy `allow`, a page, and
 * a model decision each contribute none, and the run's own cap is honoured by
 * declining to grow rather than by evicting an origin the user already
 * approved: a full allowlist costs another prompt, never a silent grant.
 */
const allowedOriginsPatch = (
  state: AgentRunState,
  effect: ResolvedAgentEffect,
  authorization: AuthorizedAgentEffect["authorization"]
): AgentStatePatch => {
  const origin = effect.destination?.origin
  if (
    authorization.type !== "approval" ||
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
  /** The visible text the guard last saw, to sign what the next step changed. */
  const progressText = new Map<string, string>()
  /** Requirements a run was already asked about once after reporting them unmet. */
  const challengedUnmet = new Map<string, Set<string>>()
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
  const noProgressCounts = new Map<string, number>()
  const refusedCommandCounts = new Map<string, number>()
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
      patch
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
      patch
    })
    if (!result.transitioned) return undefined
    if (isTerminalAgentStatus(result.state.status))
      clearBoundRequirement(state.id)
    return result.state
  }

  const pause = async (
    state: AgentRunState,
    reason: AgentPauseReason,
    extra: AgentStatePatch = {}
  ): Promise<AgentRunState | undefined> => {
    const paused = () => ({
      ...pausePatch(reason, dependencies.clock.now()),
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
    if (state.status === "paused") return state
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
    "target" | "sourceUrl" | "mutating" | "consequential" | "formAction"
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
      ...(formAction ? { formAction } : {})
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
    const checkpoint = await claim(state, "awaiting_approval", {
      deadline:
        decision.type === "approval_required"
          ? suspendAgentDeadlines(deadline, "approval", now)
          : deadline,
      updatedAt: now
    })
    if (!checkpoint) return undefined

    if (decision.type === "allow") {
      return {
        state: checkpoint,
        authorization: {
          type: "policy",
          risk: decision.risk,
          authorizedAt: dependencies.clock.now()
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
      await pause(checkpoint, "user")
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
      | "previousVerification"
      | "inspection"
      | "findings"
      | "evidenceLedger"
    >
  > => {
    try {
      const receipts = await dependencies.persistence.steps(state.id)
      const history = buildAgentHistory(receipts)
      const previous = previousAgentVerification(receipts)
      const inspection = currentAgentInspection(receipts)
      const findings = buildAgentFindings(receipts)
      const evidenceLedger = boundAgentEvidence([
        ...agentUserEvidence(state),
        ...buildAgentEvidenceLedger(receipts, state.allowedOrigins)
      ])
      return {
        ...(history.length > 0 ? { history } : {}),
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
    liveCommands.delete(stepId)
    liveCommands.set(stepId, command)
    if (liveCommands.size > MAX_LIVE_COMMANDS) {
      const oldest = liveCommands.keys().next().value
      if (oldest !== undefined) liveCommands.delete(oldest)
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
    if (carried) {
      telemetryByStep.set(write.stepId, carried)
      /** One run cannot grow this past its own step ceiling. */
      if (telemetryByStep.size > MAX_AGENT_OBSERVATIONS + 5) {
        const oldest = telemetryByStep.keys().next().value
        if (oldest !== undefined) telemetryByStep.delete(oldest)
      }
    }
    if (write.command) rememberCommand(write.stepId, write.command)
    await dependencies.persistence.appendStep({
      ...write,
      ...(thinking ? { thinking } : {}),
      ...(carried ? { telemetry: carried } : {})
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
      | "previousVerification"
      | "inspection"
      | "findings"
      | "evidenceLedger"
      | "screenshot"
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
   * Pictures the page for a model that can see, once the DOM observation is in
   * hand so the two share one identity. A capture that fails or is refused —
   * no path to the tab, a sensitive control that could not be masked — leaves
   * the decision to the DOM alone; it never fails the run, and the picture
   * lives only in the memory of this step.
   */
  /**
   * Whether this step gets a picture: what the model can read, what the user
   * asked for, and — under `auto` — whether this particular step warrants
   * one.
   *
   * A capture costs an encode, a masking pass and, far the largest of the
   * three, an image prefill in the model's own window. Most steps decide from
   * text, so most of those pictures were paid for and never looked at.
   */
  const wantsPicture = async (
    state: AgentRunState,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"],
    inspection: AgentModelInput["inspection"],
    previousVerification?: AgentVerificationResult,
    history?: AgentModelInput["history"]
  ): Promise<boolean> => {
    if (!(await dependencies.model.vision?.(state, signal))) return false
    const policy =
      (await dependencies.model.visionPolicy?.(state, signal)) ?? "always"
    if (policy === "never") return false
    if (policy === "always") return true
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

  const picture = async (
    state: AgentRunState,
    observation: AgentObservation,
    inspection: AgentModelInput["inspection"],
    signal: AgentCancellationController["signal"],
    previousVerification?: AgentVerificationResult,
    history?: AgentModelInput["history"]
  ): Promise<AgentModelInput["screenshot"]> => {
    // Native dialogs freeze the renderer; its debugger-held text is the observation.
    if (
      observation.dialogs.length ||
      !dependencies.screenshot ||
      !dependencies.model.vision
    )
      return undefined
    try {
      if (
        !(await wantsPicture(
          state,
          observation,
          signal,
          inspection,
          previousVerification,
          history
        ))
      )
        return undefined
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

  const resolveEffect = async (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "command" }>,
    observation: AgentObservation,
    context: AgentResolutionContext
  ): Promise<AgentResolutionOutcome> => {
    const { command } = decision
    if (
      command.snapshotId !== observation.snapshotId ||
      command.generation !== observation.generation
    ) {
      await fail(
        state,
        "stale_snapshot",
        "The model referenced an obsolete page snapshot."
      )
      return { type: "stopped" }
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
          state: await refuseCommand(state, command, failure.message)
        }
      }
      await fail(state, failure.code, failure.message)
      return { type: "stopped" }
    }
    refusedCommandCounts.set(state.id, 0)
    const identity = effect.snapshotIdentity
    if (
      identity.snapshotId !== observation.snapshotId ||
      identity.generation !== observation.generation ||
      identity.tabId !== observation.tabId ||
      identity.documentId !== observation.documentId
    ) {
      await fail(
        state,
        "stale_snapshot",
        "The resolved effect no longer belongs to the observed page."
      )
      return { type: "stopped" }
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
    signal: AgentCancellationController["signal"]
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
      ...(state.grants?.length ? { grants: state.grants } : {}),
      ...(authoredText?.length ? { authoredText } : {}),
      ...(state.previousRun &&
      agentRepeatsPriorForm(effect, state.previousRun.effects)
        ? { repeatsPriorForm: true }
        : {}),
      ...ownEffectPolicyFlags(ownEffect),
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
        deadline: suspendAgentDeadlines(deadline, "takeover", now),
        stepCount: stepNumber,
        updatedAt: now
      })
      if (!waiting) return undefined
      const answer = await dependencies.takeover.request(policy.request, signal)
      if (answer.type === "cancelled") await pause(waiting, "takeover")
      return undefined
    }

    const authorized = await authorize(state, policy, signal)
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
      return verifying
    }
    // A lost acknowledgement or verifier is not proof of non-execution.
    await pause(state, "unresolved_effect")
    return undefined
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
    const executing = await claim(state, "executing", {
      deadline: resumeAgentDeadlines(
        state.deadline ?? initialAgentDeadlineState(state.createdAt),
        dependencies.clock.now()
      ),
      ...allowedOriginsPatch(state, effect, authorization),
      ...(grants ? { grants } : {}),
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
      const verification = await timed("verifyMs", () =>
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
      const action = classifyVerificationOutcome(verification, policy.risk)
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
      await appendStep({
        runId: state.id,
        stepId,
        status: action.stepStatus,
        command: effect.command,
        ...stepEvidence(effect),
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
          action.reason === "unresolved_effect" ? "unresolved_effect" : "user"
        )
        return undefined
      }
      // Bind only a verified step whose execution receipt proves it opened
      // the dialog. A planned, approved, or merely attempted click is not its
      // opener and must not authorize a later dialog answer.
      if (receipt.dialogOpened && isAppliedAgentStepStatus(action.stepStatus)) {
        rememberBoundRequirement(state.id, requirementId, receipt.dialogOpened)
      }
      if (action.type === "redecide") return verifying
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
    const broken = agentForbiddingConstraints(effect, state.constraints)
    if (broken.length === 0) return undefined
    dependencies.trace?.(state.id, "constraint_refused", {
      constraints: broken.length,
      command: decision.command.type
    })
    return agentConstraintRefusal(broken)
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
      context
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
          "A page-changing command must name the planned requirement it advances in requirementId."
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
      return refuseCommand(state, decision.command, REPEATED_EFFECT_FEEDBACK)
    }
    /** Before policy, like a repeat: see `refusalByTaskContract`. */
    const contract = refusalByTaskContract(state, decision, effect)
    if (contract) return refuseCommand(state, decision.command, contract)
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
      signal
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
    observation: AgentObservation
  ) =>
    boundAgentEvidence([
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
        observation
      ),
      ...agentCompletionEvidence(
        state,
        observation,
        decision,
        steps,
        `${state.id}:answer:${state.observationCount}`
      )
    ])

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
        message: "The Agent met none of what the task asked for.",
        /** The run answered; trying the same goal again is the user's call. */
        retryable: false
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
  const challengeEarlyUnmet = (
    state: AgentRunState,
    judgement: AgentCompletionJudgement
  ): AgentCompletionJudgement => {
    if (judgement.type !== "partial" && judgement.type !== "unmet")
      return judgement
    if (MAX_AGENT_OBSERVATIONS - state.observationCount < 2) return judgement
    const asked = challengedUnmet.get(state.id) ?? new Set<string>()
    const fresh = judgement.outcome.unmet.filter((id) => !asked.has(id))
    if (fresh.length === 0) return judgement
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
    { judgement: AgentCompletionJudgement; reviewed: boolean } | undefined
  > => {
    const port = dependencies.review
    if (!port || !agentCompletionNeedsReview(judgement))
      return { judgement, reviewed: false }
    /**
     * The receipts are the count that survives a worker restart; memory
     * covers a review whose receipt could not be read back. The larger wins,
     * so a restart never refunds the run's ceiling.
     */
    const spent = Math.max(
      reviewsByRun.get(state.id) ?? 0,
      agentRecordedReviews(steps)
    )
    if (spent >= MAX_AGENT_COMPLETION_REVIEWS) {
      dependencies.trace?.(state.id, "completion_review_budget_exhausted", {
        reviews: spent
      })
      return { judgement, reviewed: false }
    }
    reviewsByRun.set(state.id, spent + 1)
    const request = agentCompletionReviewRequest(
      state,
      judgement.review,
      decision.outcomes,
      completionLedger(state, decision, steps, observation)
    )
    const startedAt = dependencies.clock.now()
    let answer: unknown
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
    if (signal.aborted) return undefined
    const parsed = AgentCompletionReviewSchema.safeParse(answer)
    if (!parsed.success) {
      dependencies.trace?.(state.id, "completion_review_malformed")
      return { judgement, reviewed: true }
    }
    const result = applyAgentCompletionReview(judgement, request, parsed.data)
    measure({ reviewDisagreements: result.disagreements })
    dependencies.trace?.(state.id, "completion_reviewed", {
      asked:
        judgement.review.requirementIds.length +
        judgement.review.constraintIds.length,
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

  const processCompletion = async (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "complete" }>,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"]
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
    const baseline =
      changeBaseline?.runId === state.id ? changeBaseline.text : undefined
    const settled = await settleCompletion(
      state,
      {
        steps,
        observation,
        evidence: decision.evidence,
        baselineText: baseline,
        evidenceLedger: completionLedger(state, decision, steps, observation),
        constraints: state.constraints,
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
    if (outstanding) judgement = outstanding
    else {
      const review = await reviewCompletion(
        state,
        settled.judgement,
        decision,
        steps,
        observation,
        signal
      )
      if (!review) return undefined
      reviewed = review.reviewed
      judgement = challengeEarlyUnmet(state, review.judgement)
    }
    if (judgement.type !== "refused") {
      const evidenceLedger = completionLedger(
        state,
        decision,
        steps,
        observation
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
              summary: REVIEW_SUPPORTED_SUMMARY,
              observedAt: now
            }
          }
        })
      }
      reviewsByRun.delete(state.id)
      await settleJudgedRun(
        state,
        judgement,
        agentRunResult(
          decision.summary,
          state.requirements,
          decision.outcomes,
          judgement.outcome?.met
        ),
        evidenceLedger
      )
      return undefined
    }
    if (await exhaustedNoProgressBudget(state, observation, decision))
      return undefined
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
    await appendStep({
      runId: state.id,
      stepId: `${state.id}:completion:${state.observationCount}`,
      status: "rejected",
      at: now,
      verification: {
        outcome: "negative",
        evidence: {
          kind: "completion",
          summary: judgement.feedback,
          observedAt: now
        }
      }
    })
    /**
     * A refusal must not be able to consume the run. Looking again is the
     * right answer the first time — the indicator may simply not have
     * appeared yet — and the wrong one once the same refusal has come back
     * unchanged: nothing the run can see on its own is going to settle it, so
     * the person who set the goal is asked.
     */
    if (refusals >= MAX_CONSECUTIVE_REFUSED_COMPLETIONS) {
      await pause(state, "question", {
        question: {
          id: `${state.id}:q${state.observationCount}`,
          text: `${judgement.feedback} I have reported this task finished twice and cannot support the claim. Is it done, and if not, what should I do next?`,
          display: [
            {
              key: "agent.question_text.completion_refused"
            }
          ],
          askedAt: dependencies.clock.now()
        }
      })
      return undefined
    }
    return claimObserving(state, false, ["deciding"])
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
    feedback: string
  ): Promise<AgentRunState | undefined> => {
    const refusals = (refusedCommandCounts.get(state.id) ?? 0) + 1
    refusedCommandCounts.set(state.id, refusals)
    const now = dependencies.clock.now()
    dependencies.trace?.(state.id, "command_refused", { refusals })
    await appendStep({
      runId: state.id,
      stepId: `${state.id}:refused:${state.observationCount}:${refusals}`,
      status: "rejected",
      command,
      at: now,
      verification: {
        outcome: "negative",
        evidence: { kind: "resolution", summary: feedback, observedAt: now }
      }
    })
    if (refusals >= MAX_CONSECUTIVE_REFUSED_COMMANDS) {
      await pause(state, "question", {
        question: {
          id: `${state.id}:q${state.observationCount}`,
          text: `${feedback} What should I try instead?`,
          display: [
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
      return processCompletion(state, decision, observation, signal)
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

  const exhaustedNoProgressBudget = async (
    state: AgentRunState,
    observation: AgentObservation,
    decision: AgentDecision
  ): Promise<boolean> => {
    const changeSignature = agentTextChangeSignature(
      progressText.get(state.id),
      observation.visibleText
    )
    progressText.set(state.id, observation.visibleText)
    const progress: AgentProgressPoint = {
      url: observation.url,
      snapshotHash: hashAgentObservation(observation, decision),
      decision,
      ...(changeSignature ? { changeSignature } : {})
    }
    const result = classifyNoProgress({
      previous: previousProgress.get(state.id),
      recent: recentProgress.get(state.id),
      current: progress,
      previousCount: noProgressCounts.get(state.id)
    })
    previousProgress.set(state.id, progress)
    recentProgress.set(
      state.id,
      [...(recentProgress.get(state.id) ?? []), progress].slice(-6)
    )
    noProgressCounts.set(state.id, result.count)
    if (result.count < MAX_CONSECUTIVE_NO_PROGRESS) return false
    await pause(state, "question", {
      question: {
        id: `${state.id}:q${state.observationCount}`,
        text: "I am repeating actions without progress. What should I do differently? You can also stop and finish this task yourself.",
        display: [{ key: "agent.question_text.no_progress" }],
        askedAt: dependencies.clock.now()
      }
    })
    return true
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
    const expired = expiredAgentDeadline(deadline, dependencies.clock.now())
    if (!expired) return false
    await fail(
      state,
      "budget_exhausted",
      expired === "run"
        ? "The Agent run exceeded its active time budget."
        : "This Agent step exceeded its active time budget."
    )
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
    signal: AgentCancellationController["signal"]
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
    const deciding = await claim(state, "deciding", {
      observationCount: state.observationCount + 1,
      ...(steering?.length ? { answers } : {}),
      ...amendment.patch,
      updatedAt: dependencies.clock.now()
    })
    return deciding ? { state: deciding, stop: amendment.stop } : undefined
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
    | undefined
  > => {
    const recalled = await recallHistory(state)
    const observation = await observe(state, signal, recalled.inspection)
    if (!observation) return undefined
    /**
     * Taken off the queue only once the claim that records it has landed. A
     * pause or stop that wins the claim leaves the correction queued for the
     * decision after the resume, rather than accepted and then dropped.
     */
    const steering = pendingSteering.get(state.id)
    const claimed = await claimDeciding(state, steering, signal)
    if (!claimed) return undefined
    const deciding = claimed.state
    if (steering?.length) {
      const queued = pendingSteering.get(state.id) ?? []
      /** By identity: a correction typed during the claim is still waiting. */
      const later = queued.filter((entry) => !steering.includes(entry))
      if (later.length > 0) pendingSteering.set(state.id, later)
      else pendingSteering.delete(state.id)
    }
    /**
     * A new instruction is new ground: the no-progress and refusal memory
     * describe the approach the user just corrected.
     */
    if (steering?.length) {
      previousProgress.delete(state.id)
      recentProgress.delete(state.id)
      progressText.delete(state.id)
      challengedUnmet.delete(state.id)
      clearBoundRequirement(state.id)
      noProgressCounts.delete(state.id)
      refusedCommandCounts.delete(state.id)
      refusedCompletions.delete(state.id)
    }
    if (claimed.stop && (await stopsBeforePlanning(deciding, claimed.stop)))
      return undefined
    if (deciding.plan?.pending) {
      await askRemoval(deciding)
      return undefined
    }
    if (recalled.evidenceLedger)
      recalled.evidenceLedger = buildAgentEvidenceLedger(
        [
          {
            runId: state.id,
            stepId: "recall",
            status: "verified",
            at: 0,
            sequence: 0,
            evidenceLedger: [...recalled.evidenceLedger]
          }
        ],
        deciding.allowedOrigins,
        observation
      )
    let decision: AgentDecision | undefined
    const context: AgentResolutionContext = {}
    try {
      const screenshot = await picture(
        deciding,
        observation,
        recalled.inspection,
        signal,
        recalled.previousVerification,
        recalled.history
      )
      if (screenshot) context.screenshot = screenshot
      decision = await decide(deciding, observation, signal, {
        ...recalled,
        ...(screenshot ? { screenshot } : {})
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
    if (
      decision.type !== "complete" &&
      (await exhaustedNoProgressBudget(deciding, observation, decision))
    ) {
      return undefined
    }
    return { state: deciding, observation, decision, context }
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
    const startedAt = dependencies.clock.now()
    let amended: AgentTaskPlan
    try {
      amended = await plan({ ...state, answers }, signal)
    } catch (error) {
      measure({ planMs: dependencies.clock.now() - startedAt })
      if (signal.aborted) return { patch: {} }
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
      if (state.observationCount >= MAX_AGENT_OBSERVATIONS) {
        await fail(
          state,
          "budget_exhausted",
          "The Agent observation budget is exhausted."
        )
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

      const next = await processDecision(
        state,
        prepared.decision,
        prepared.observation,
        controller.signal,
        prepared.context
      )
      if (!next) return
      state = next
      observingClaimed = next.status === "observing"
      // Both confirmed and a provable safe negative require a fresh
      // observation and model decision; neither repeats the command here.
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
    } finally {
      if (active.get(runId) === controller) active.delete(runId)
      await forgetUnheardSteering(runId)
    }
  }

  const requestPause = async (
    runId: string,
    reason: AgentPauseReason = "user"
  ): Promise<void> => {
    const state = await dependencies.persistence.load(runId)
    if (!state || isTerminalAgentStatus(state.status)) return
    const requested = await transition(state, "pause_requested", {
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
    })
    if (!requested) return
    active.get(runId)?.abort()
    await transition(
      requested,
      "paused",
      pausePatch(
        state.status === "executing" || state.status === "verifying"
          ? "unresolved_effect"
          : reason,
        dependencies.clock.now()
      )
    )
  }

  const requestCancel = async (runId: string): Promise<void> => {
    const state = await dependencies.persistence.load(runId)
    if (!state || isTerminalAgentStatus(state.status)) return
    const cancelling = await transition(state, "cancelling", {
      updatedAt: dependencies.clock.now()
    })
    if (!cancelling) return
    active.get(runId)?.abort()
    await transition(cancelling, "cancelled", {
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
      previousProgress.delete(state.id)
      recentProgress.delete(state.id)
      progressText.delete(state.id)
      challengedUnmet.delete(state.id)
      clearBoundRequirement(state.id)
      noProgressCounts.delete(state.id)
      refusedCommandCounts.delete(state.id)
      refusedCompletions.delete(state.id)
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
      previousProgress.delete(state.id)
      recentProgress.delete(state.id)
      progressText.delete(state.id)
      challengedUnmet.delete(state.id)
      clearBoundRequirement(state.id)
      noProgressCounts.delete(state.id)
      refusedCommandCounts.delete(state.id)
      refusedCompletions.delete(state.id)
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
      previousProgress.delete(state.id)
      recentProgress.delete(state.id)
      progressText.delete(state.id)
      challengedUnmet.delete(state.id)
      clearBoundRequirement(state.id)
      noProgressCounts.delete(state.id)
      refusedCommandCounts.delete(state.id)
      refusedCompletions.delete(state.id)
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
