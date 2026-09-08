import {
  type AgentDecision,
  AgentDecisionSchema,
  type AgentObservation,
  AgentObservationSchema,
  type AgentPauseReason,
  type AgentRunState,
  type AgentRunStatus,
  MAX_AGENT_ALLOWED_ORIGINS
} from "@ollama-client/contracts"
import {
  type AgentProgressPoint,
  beginAgentStepDeadline,
  classifyNoProgress,
  expiredAgentDeadline,
  hashAgentObservation,
  initialAgentDeadlineState,
  resumeAgentDeadlines,
  suspendAgentDeadlines
} from "./budgets"
import { agentObservationFailureMessage } from "./control-failure"
import {
  agentStepSourceUrl,
  agentStepTargetFrom,
  buildAgentHistory,
  previousAgentVerification
} from "./history"
import type {
  AgentCancellationController,
  AgentController,
  AgentControllerDependencies,
  AgentModelInput,
  AgentPolicyDecision,
  AgentStatePatch,
  AgentStepWrite,
  AuthorizedAgentEffect,
  ResolvedAgentEffect
} from "./ports"
import {
  AgentEffectNotAppliedError,
  AgentMalformedDecisionError,
  agentFailure,
  pausePatch
} from "./ports"
import { agentResolutionFailure } from "./resolution-failure"
import { AGENT_STATUS_PREDECESSORS, isTerminalAgentStatus } from "./state"
import { classifyVerificationOutcome } from "./verification"

const MAX_CONSECUTIVE_NO_PROGRESS = 3

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
  const noProgressCounts = new Map<string, number>()

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
    return result.transitioned ? result.state : undefined
  }

  const pause = async (
    state: AgentRunState,
    reason: AgentPauseReason
  ): Promise<AgentRunState | undefined> => {
    if (state.status === "paused") return state
    if (state.status === "pause_requested") {
      return transition(
        state,
        "paused",
        pausePatch(reason, dependencies.clock.now())
      )
    }
    if (
      (AGENT_STATUS_PREDECESSORS.paused as readonly AgentRunStatus[]).includes(
        state.status
      )
    ) {
      return transition(
        state,
        "paused",
        pausePatch(reason, dependencies.clock.now())
      )
    }
    const requested = await transition(
      state,
      "pause_requested",
      pausePatch(reason, dependencies.clock.now())
    )
    return requested
      ? transition(
          requested,
          "paused",
          pausePatch(reason, dependencies.clock.now())
        )
      : undefined
  }

  /**
   * What every receipt for this effect records beyond the command itself. A
   * command holds a ref, and a ref means nothing after the next observation,
   * so without this the run could not describe a step it had taken.
   */
  const stepEvidence = (
    effect: ResolvedAgentEffect
  ): Pick<AgentStepWrite, "target" | "sourceUrl"> => {
    const target = agentStepTargetFrom(effect.target)
    /**
     * Origin and path only. A receipt is durable and is read back into a
     * prompt, so a page whose URL carries a token in its query, a secret in
     * its fragment or credentials in its userinfo must not leave one behind.
     */
    const sourceUrl = effect.sourceUrl
      ? agentStepSourceUrl(effect.sourceUrl)
      : undefined
    return {
      ...(target ? { target } : {}),
      ...(sourceUrl ? { sourceUrl } : {})
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

  const authorize = async (
    state: AgentRunState,
    decision: Extract<
      AgentPolicyDecision,
      { type: "allow" | "approval_required" }
    >,
    signal: AgentCancellationController["signal"]
  ): Promise<
    | {
        state: AgentRunState
        authorization: AuthorizedAgentEffect["authorization"]
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

    const answer = await dependencies.approval.request(decision.request, signal)
    if (answer.type !== "approved") {
      await pause(checkpoint, "user")
      return undefined
    }
    return {
      state: checkpoint,
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
  ): Promise<Pick<AgentModelInput, "history" | "previousVerification">> => {
    try {
      const receipts = await dependencies.persistence.steps(state.id)
      const history = buildAgentHistory(receipts)
      const previous = previousAgentVerification(receipts)
      return {
        ...(history.length > 0 ? { history } : {}),
        ...(previous ? { previousVerification: previous } : {})
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

  const decide = async (
    state: AgentRunState,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"],
    recalled: Pick<AgentModelInput, "history" | "previousVerification">
  ) => {
    let raw: unknown
    try {
      raw = await dependencies.model.decide(
        { state, observation, ...recalled },
        signal
      )
    } catch (error) {
      if (error instanceof AgentMalformedDecisionError) return undefined
      throw error
    }
    return AgentDecisionSchema.safeParse(raw).data
  }

  const observe = async (
    state: AgentRunState,
    signal: AgentCancellationController["signal"]
  ): Promise<AgentObservation | undefined> => {
    try {
      const observation = AgentObservationSchema.parse(
        await dependencies.observation.observe(
          {
            runId: state.id,
            tabId: state.controlledTabId,
            minimumGeneration: minimumGeneration.get(state.id) ?? 0
          },
          signal
        )
      )
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

  const resolveEffect = async (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "command" }>,
    observation: AgentObservation
  ): Promise<ResolvedAgentEffect | undefined> => {
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
      return undefined
    }

    let effect: ResolvedAgentEffect
    try {
      effect = await dependencies.effect.resolve(command, observation)
    } catch (error) {
      /**
       * Nothing was done to the page, so the run has lost track of nothing —
       * calling any of this a verification failure said the opposite. But a
       * refused command and a page that went stale under it are different
       * facts, and only the first is the model's to hear about.
       */
      const failure = agentResolutionFailure(error)
      await fail(state, failure.code, failure.message)
      return undefined
    }
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
      return undefined
    }
    return effect
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
          { type: "allow" | "approval_required" }
        >
        authorization: AuthorizedAgentEffect["authorization"]
      }
    | undefined
  > => {
    const policy = dependencies.policy.evaluate({
      runId: state.id,
      stepId,
      effect,
      allowedOrigins: state.allowedOrigins,
      now: dependencies.clock.now()
    })
    if (policy.type === "blocked") {
      await dependencies.persistence.appendStep({
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
      await dependencies.persistence.appendStep({
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
            summary: "Target changed; no browser effect was attempted",
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
      { type: "allow" | "approval_required" }
    >,
    stepId: string,
    stepNumber: number,
    signal: AgentCancellationController["signal"]
  ): Promise<AgentRunState | undefined> => {
    await dependencies.persistence.appendStep({
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
      stepCount: stepNumber,
      updatedAt: dependencies.clock.now()
    })
    if (!executing) return undefined
    const authorizedEffect: AuthorizedAgentEffect = { ...effect, authorization }
    let failureState = executing

    try {
      const receipt = await dependencies.effect.execute(
        authorizedEffect,
        signal
      )
      await dependencies.persistence.appendStep({
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
      const verification = await dependencies.effect.verify(
        { effect: authorizedEffect, receipt, before: observation },
        signal
      )
      const action = classifyVerificationOutcome(verification, policy.risk)
      await dependencies.persistence.appendStep({
        runId: state.id,
        stepId,
        status: action.stepStatus,
        command: effect.command,
        ...stepEvidence(effect),
        risk: policy.risk,
        verification,
        at: dependencies.clock.now()
      })
      if (action.type === "pause") {
        await pause(
          verifying,
          action.reason === "unresolved_effect" ? "unresolved_effect" : "user"
        )
        return undefined
      }
      if (action.type === "redecide") return verifying
      previousProgress.delete(state.id)
      noProgressCounts.set(state.id, 0)
      // The write closing a confirmed step also opens the next observation, so
      // a tab the effect switched to is durably owned before this controller
      // can lose the run. Only the verifying run this step owns may be claimed:
      // a pause or cancellation that raced verification has already recorded
      // the effect as unresolved, and resurrecting it here would restart a run
      // the user stopped. A negative or ambiguous outcome never reaches here
      // and leaves the run on the tab it already controls.
      return claim(
        verifying,
        "observing",
        {
          ...(receipt.controlledTabId === undefined
            ? {}
            : { controlledTabId: receipt.controlledTabId }),
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

  const processCommand = async (
    state: AgentRunState,
    decision: Extract<AgentDecision, { type: "command" }>,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"]
  ): Promise<AgentRunState | undefined> => {
    const effect = await resolveEffect(state, decision, observation)
    if (!effect) return undefined
    /** The last point a run may stop without owing an account of an effect. */
    if (await exhaustedTimeBudget(state)) return undefined
    const stepNumber = state.stepCount + 1
    const stepId = `${state.id}:${stepNumber}`
    await dependencies.persistence.appendStep({
      runId: state.id,
      stepId,
      status: "planned",
      command: decision.command,
      ...stepEvidence(effect),
      ...(decision.finding ? { finding: decision.finding } : {}),
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
      signal
    )
  }

  const processDecision = async (
    state: AgentRunState,
    decision: AgentDecision,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"]
  ): Promise<AgentRunState | undefined> => {
    if (decision.type === "complete") {
      await transition(state, "completed", {
        result: decision.summary,
        updatedAt: dependencies.clock.now()
      })
      return undefined
    }
    if (decision.type === "fail") {
      /** The model answered; it just cannot do this. The endpoint is fine. */
      await fail(state, "goal_failed", decision.reason)
      return undefined
    }
    if (decision.type === "ask_user") {
      await pause(state, "user")
      return undefined
    }
    return processCommand(state, decision, observation, signal)
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
    const progress: AgentProgressPoint = {
      url: observation.url,
      snapshotHash: hashAgentObservation(observation),
      decision
    }
    const result = classifyNoProgress({
      previous: previousProgress.get(state.id),
      current: progress,
      previousCount: noProgressCounts.get(state.id)
    })
    previousProgress.set(state.id, progress)
    noProgressCounts.set(state.id, result.count)
    if (result.count < MAX_CONSECUTIVE_NO_PROGRESS) return false
    await fail(
      state,
      "budget_exhausted",
      "The agent repeated the same decision without page progress."
    )
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

  const observeAndDecide = async (
    state: AgentRunState,
    signal: AgentCancellationController["signal"]
  ): Promise<
    | {
        state: AgentRunState
        observation: AgentObservation
        decision: AgentDecision
      }
    | undefined
  > => {
    const observation = await observe(state, signal)
    if (!observation) return undefined
    const deciding = await claim(state, "deciding", {
      observationCount: state.observationCount + 1,
      updatedAt: dependencies.clock.now()
    })
    if (!deciding) return undefined
    let decision: AgentDecision | undefined
    try {
      decision = await decide(
        deciding,
        observation,
        signal,
        await recallHistory(deciding)
      )
    } catch {
      if (!signal.aborted) {
        await fail(
          deciding,
          "model_unavailable",
          "The selected model could not produce an Agent decision."
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
    if (await exhaustedNoProgressBudget(deciding, observation, decision)) {
      return undefined
    }
    return { state: deciding, observation, decision }
  }

  const runLoop = async (
    initialState: AgentRunState,
    controller: AgentCancellationController,
    afterTakeover = false
  ): Promise<void> => {
    let state = initialState
    // A confirmed step already claimed the next observing phase, durably, in
    // the write that closed it; re-claiming it here would lose that CAS.
    let observingClaimed = false
    // Only the first iteration may enter from a resumed or recovered status;
    // later ones come from the step they just closed, so a pause that raced
    // that step cannot be claimed back into observation.
    let entered = false
    while (!controller.signal.aborted) {
      if (state.observationCount >= 25) {
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
        controller.signal
      )
      if (!next) return
      state = next
      observingClaimed = next.status === "observing"
      // Both confirmed and a provable safe negative require a fresh
      // observation and model decision; neither repeats the command here.
    }
  }

  const run = async (runId: string, afterTakeover = false): Promise<void> => {
    if (active.has(runId)) return

    const controller = createCancellationController()
    active.set(runId, controller)
    try {
      const state = await dependencies.persistence.load(runId)
      if (!state || isTerminalAgentStatus(state.status)) return
      if (state.pauseReason === "unresolved_effect") return
      if (state.status === "awaiting_takeover" && !afterTakeover) return
      await runLoop(state, controller, afterTakeover)
    } finally {
      if (active.get(runId) === controller) active.delete(runId)
    }
  }

  const requestPause = async (runId: string): Promise<void> => {
    const state = await dependencies.persistence.load(runId)
    if (!state || isTerminalAgentStatus(state.status)) return
    const requested = await transition(
      state,
      "pause_requested",
      pausePatch("user", dependencies.clock.now())
    )
    if (!requested) return
    active.get(runId)?.abort()
    await transition(
      requested,
      "paused",
      pausePatch(
        state.status === "executing" || state.status === "verifying"
          ? "unresolved_effect"
          : "user",
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
    resume: (runId) => run(runId),
    requestCancel,
    completeTakeover
  }
}
