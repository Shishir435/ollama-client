import {
  type AgentDecision,
  AgentDecisionSchema,
  type AgentObservation,
  AgentObservationSchema,
  type AgentPauseReason,
  type AgentRunState,
  type AgentRunStatus
} from "@ollama-client/contracts"
import {
  beginAgentStepDeadline,
  initialAgentDeadlineState,
  resumeAgentDeadlines,
  suspendAgentDeadlines
} from "./budgets"
import type {
  AgentCancellationController,
  AgentController,
  AgentControllerDependencies,
  AgentPolicyDecision,
  AgentStatePatch,
  AuthorizedAgentEffect,
  ResolvedAgentEffect
} from "./ports"
import { agentFailure, pausePatch } from "./ports"
import { AGENT_STATUS_PREDECESSORS, isTerminalAgentStatus } from "./state"
import { classifyVerificationOutcome } from "./verification"

const DEFAULT_MAX_MALFORMED_DECISIONS = 5

export const createAgentController = (
  dependencies: AgentControllerDependencies
): AgentController => {
  const createCancellationController =
    dependencies.createCancellationController ??
    (() => {
      let aborted = false
      const controller: AgentCancellationController = {
        signal: {
          get aborted() {
            return aborted
          }
        },
        abort() {
          aborted = true
        }
      }
      return controller
    })
  const active = new Map<string, AgentCancellationController>()
  const lastGeneration = new Map<string, number>()
  const minimumGeneration = new Map<string, number>()

  const claim = async (
    state: AgentRunState,
    phase: AgentRunStatus,
    patch?: AgentStatePatch
  ): Promise<AgentRunState | undefined> => {
    const result = await dependencies.persistence.claim({
      runId: state.id,
      phase,
      expected: AGENT_STATUS_PREDECESSORS[phase],
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

  const decide = async (
    state: AgentRunState,
    observation: AgentObservation,
    signal: AgentCancellationController["signal"]
  ) => {
    const maximum =
      dependencies.maxMalformedDecisions ?? DEFAULT_MAX_MALFORMED_DECISIONS
    for (let attempt = 1; attempt <= maximum; attempt += 1) {
      const raw = await dependencies.model.decide(
        { state, observation },
        signal
      )
      const parsed = AgentDecisionSchema.safeParse(raw)
      if (parsed.success) return parsed.data
    }
    return undefined
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
    } catch {
      if (!signal.aborted) {
        await fail(
          state,
          "observation_failed",
          "The current page could not be observed safely."
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
    } catch {
      await fail(
        state,
        "verification_failed",
        "The proposed page effect could not be resolved safely."
      )
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
      risk: policy.risk,
      at: dependencies.clock.now()
    })
    const executing = await claim(state, "executing", {
      deadline: resumeAgentDeadlines(
        state.deadline ?? initialAgentDeadlineState(state.createdAt),
        dependencies.clock.now()
      ),
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
      return verifying
    } catch {
      if (!signal.aborted) {
        await fail(
          failureState,
          "verification_failed",
          "The page effect could not be executed and verified safely."
        )
      }
      return undefined
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
    const stepNumber = state.stepCount + 1
    const stepId = `${state.id}:${stepNumber}`
    await dependencies.persistence.appendStep({
      runId: state.id,
      stepId,
      status: "planned",
      command: decision.command,
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
        updatedAt: dependencies.clock.now()
      })
      return undefined
    }
    if (decision.type === "fail") {
      await fail(state, "model_unavailable", decision.reason)
      return undefined
    }
    if (decision.type === "ask_user") {
      await pause(state, "user")
      return undefined
    }
    return processCommand(state, decision, observation, signal)
  }

  const runLoop = async (
    initialState: AgentRunState,
    controller: AgentCancellationController,
    afterTakeover = false
  ): Promise<void> => {
    let state = initialState
    while (!controller.signal.aborted) {
      const observing = await claim(state, "observing", {
        ...((afterTakeover || state.status === "paused") && state.deadline
          ? {
              deadline: resumeAgentDeadlines(
                state.deadline,
                dependencies.clock.now()
              )
            }
          : {}),
        updatedAt: dependencies.clock.now()
      })
      if (!observing) return
      state = observing
      const observation = await observe(state, controller.signal)
      if (!observation) return

      const deciding = await claim(state, "deciding", {
        observationCount: state.observationCount + 1,
        updatedAt: dependencies.clock.now()
      })
      if (!deciding) return
      state = deciding

      const modelDecision = await decide(state, observation, controller.signal)
      if (!modelDecision) {
        await fail(
          state,
          "invalid_decision",
          "The model returned too many invalid decisions."
        )
        return
      }

      const next = await processDecision(
        state,
        modelDecision,
        observation,
        controller.signal
      )
      if (!next) return
      state = next
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
