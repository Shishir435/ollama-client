import {
  type AgentDeadlineState,
  AgentDeadlineStateSchema,
  type AgentDecision,
  type AgentElement,
  type AgentObservation
} from "@ollama-client/contracts"

export const initialAgentDeadlineState = (now: number): AgentDeadlineState => ({
  runStartedAt: now,
  stepStartedAt: now,
  runSuspendedMs: 0,
  stepSuspendedMs: 0
})

export const beginAgentStepDeadline = (
  state: AgentDeadlineState,
  now: number
): AgentDeadlineState =>
  AgentDeadlineStateSchema.parse({
    ...state,
    stepStartedAt: now,
    stepSuspendedMs: 0
  })

export const suspendAgentDeadlines = (
  state: AgentDeadlineState,
  kind: "approval" | "takeover" | "user" | "question",
  now: number
): AgentDeadlineState =>
  state.suspendedAt === undefined
    ? AgentDeadlineStateSchema.parse({
        ...state,
        suspendedAt: now,
        suspensionKind: kind
      })
    : state

export const resumeAgentDeadlines = (
  state: AgentDeadlineState,
  now: number
): AgentDeadlineState => {
  if (state.suspendedAt === undefined) return state
  const duration = Math.max(0, now - state.suspendedAt)
  const {
    suspendedAt: _suspendedAt,
    suspensionKind: _suspensionKind,
    ...active
  } = state
  return AgentDeadlineStateSchema.parse({
    ...active,
    runSuspendedMs: state.runSuspendedMs + duration,
    stepSuspendedMs: state.stepSuspendedMs + duration
  })
}

/**
 * The two active-time ceilings the product promises. Wall-clock time a user
 * spent deciding on an approval or finishing a takeover is not the run's, so
 * both are measured against the suspension accounting in the durable deadline
 * rather than against the clock alone.
 */
export const AGENT_RUN_ACTIVE_BUDGET_MS = 10 * 60_000
export const AGENT_STEP_ACTIVE_BUDGET_MS = 60_000

const activeElapsed = (
  startedAt: number,
  suspendedMs: number,
  state: AgentDeadlineState,
  now: number
): number => {
  const openSuspension =
    state.suspendedAt === undefined ? 0 : Math.max(0, now - state.suspendedAt)
  return Math.max(0, now - startedAt - suspendedMs - openSuspension)
}

/**
 * Which ceiling a run has passed, if either. Returned rather than thrown
 * because the caller decides where a run may be stopped: mid-step is not one
 * of those places, since an effect already applied has to be verified.
 */
export const expiredAgentDeadline = (
  state: AgentDeadlineState,
  now: number,
  budgets: { runMs?: number; stepMs?: number } = {}
): "run" | "step" | undefined => {
  if (
    activeElapsed(state.runStartedAt, state.runSuspendedMs, state, now) >=
    (budgets.runMs ?? AGENT_RUN_ACTIVE_BUDGET_MS)
  ) {
    return "run"
  }
  return activeElapsed(
    state.stepStartedAt,
    state.stepSuspendedMs,
    state,
    now
  ) >= (budgets.stepMs ?? AGENT_STEP_ACTIVE_BUDGET_MS)
    ? "step"
    : undefined
}

export interface AgentProgressPoint {
  url: string
  snapshotHash: string
  decision: AgentDecision
}

export interface AgentNoProgressInput {
  previous?: AgentProgressPoint
  recent?: readonly AgentProgressPoint[]
  current: AgentProgressPoint
  previousCount?: number
}

export interface AgentNoProgressResult {
  noProgress: boolean
  count: number
}

const decisionFingerprint = (decision: AgentDecision): string => {
  if (decision.type === "complete") return "complete"
  if (decision.type !== "command") return JSON.stringify(decision)
  const {
    snapshotId: _snapshotId,
    generation: _generation,
    ...command
  } = decision.command
  return JSON.stringify({ type: "command", command })
}

const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/** Shared with prompt projection so loop detection compares the requested controls. */
export const matchesAgentInspection = (
  element: AgentElement,
  focus: { region?: string; query?: string }
): boolean => {
  if (focus.region !== undefined)
    return (element.group ?? "page") === focus.region
  if (focus.query === undefined) return false
  const needle = focus.query.toLowerCase()
  return [
    element.name,
    element.placeholder,
    element.role,
    element.tag,
    element.type
  ].some((value) => value?.toLowerCase().includes(needle))
}

/** Ignore unrelated page churn for targeted reads, but never ignore a changed answer. */
export const hashAgentObservation = (
  observation: AgentObservation,
  decision?: AgentDecision
): string => {
  const command = decision?.type === "command" ? decision.command : undefined
  if (command?.type === "inspect" || command?.type === "find") {
    const focus =
      command.type === "inspect"
        ? { region: command.target }
        : { query: command.query }
    return fnv1a(
      JSON.stringify(
        observation.elements
          .filter((element) => matchesAgentInspection(element, focus))
          .map(({ verificationId: _verificationId, ...element }) => element)
      )
    )
  }
  return fnv1a(
    JSON.stringify({
      url: observation.url,
      title: observation.title,
      elements: observation.elements,
      visibleText: observation.visibleText,
      scroll: observation.scroll,
      dialogs: observation.dialogs,
      textPage: observation.textPage
    })
  )
}

export const classifyNoProgress = (
  input: AgentNoProgressInput
): AgentNoProgressResult => {
  if (input.current.decision.type === "command") {
    if (input.current.decision.command.type === "wait") {
      return { noProgress: false, count: input.previousCount ?? 0 }
    }
  }
  const candidates = input.recent ?? (input.previous ? [input.previous] : [])
  const same = candidates.some(
    (previous) =>
      previous.url === input.current.url &&
      decisionFingerprint(previous.decision) ===
        decisionFingerprint(input.current.decision) &&
      previous.snapshotHash === input.current.snapshotHash
  )
  return {
    noProgress: same,
    count: same ? (input.previousCount ?? 0) + 1 : 0
  }
}
