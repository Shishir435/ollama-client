import {
  type AgentDeadlineState,
  AgentDeadlineStateSchema,
  type AgentDecision,
  type AgentElement,
  type AgentObservation,
  type AgentRunState,
  agentObservationBudget,
  MAX_AGENT_OBSERVATIONS
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
 * How long one decision may take before the host gives up on the model.
 *
 * Declared here rather than beside the host that enforces it, because the
 * step budget below has to be sized against it and two files cannot own one
 * ordering. A provider that accepts the request and never answers is what
 * this exists to turn into a reported failure; it does not police latency.
 */
export const AGENT_DECISION_TIMEOUT_MS = 120_000

/**
 * The two active-time ceilings the product promises. Wall-clock time a user
 * spent deciding on an approval or finishing a takeover is not the run's, so
 * both are measured against the suspension accounting in the durable deadline
 * rather than against the clock alone.
 *
 * The step ceiling is strictly greater than the decision timeout, and that is
 * the whole reason for its value. It was sixty seconds while a decision was
 * allowed a hundred and twenty, so a model that answered in ninety — well
 * inside what it had been promised — had its perfectly good step killed with
 * "this Agent step exceeded its active time budget", which reads like a hung
 * page and is not. A step is a decision plus an observation, an execution and
 * a verification that may itself wait for the page, so the ceiling is the
 * decision timeout with room for the rest of the step around it.
 *
 * The run ceiling follows from the other two: a fifty-step run whose
 * decisions measured two to forty-one seconds apiece needs the better part of
 * half an hour, and ten minutes stopped honest runs a third of the way in.
 * What bounds a runaway run is the observation ceiling and the no-progress
 * guard, not this; this exists so a run cannot sit burning a remote provider
 * indefinitely.
 */
export const AGENT_RUN_ACTIVE_BUDGET_MS = 40 * 60_000
export const AGENT_STEP_ACTIVE_BUDGET_MS = 3 * 60_000

/**
 * The run's active-time ceiling, grown in the same proportion as its
 * observation budget: a plan that earned more looks earned the time to take
 * them, and a one-line task keeps forty minutes.
 */
export const agentRunActiveBudgetMs = (
  state: Pick<AgentRunState, "requirements">
): number =>
  Math.round(
    (AGENT_RUN_ACTIVE_BUDGET_MS * agentObservationBudget(state)) /
      MAX_AGENT_OBSERVATIONS
  )

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

/** Active time still available to inference; waiting for a provider is active time. */
export const remainingAgentActiveBudgetMs = (
  state: AgentDeadlineState,
  now: number,
  runMs: number = AGENT_RUN_ACTIVE_BUDGET_MS
): number =>
  Math.max(
    0,
    Math.min(
      runMs -
        activeElapsed(state.runStartedAt, state.runSuspendedMs, state, now),
      AGENT_STEP_ACTIVE_BUDGET_MS -
        activeElapsed(state.stepStartedAt, state.stepSuspendedMs, state, now)
    )
  )

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

/**
 * What the run has left, in the terms the model is asked to spend.
 *
 * `MAX_AGENT_OBSERVATIONS` counts one observation per decision, so the two
 * figures are the same ceiling read two ways; both are reported because the
 * model is told about steps and the panel shows observations. Derived rather
 * than stored: the durable counters are the truth and a second copy would
 * drift from them.
 */
export interface AgentRemainingBudget {
  observationsUsed: number
  observationsRemaining: number
  maxObservations: number
  /** Decisions left before the run is stopped, which is the same number. */
  stepsRemaining: number
}

export const agentRemainingBudget = (
  state: Pick<AgentRunState, "observationCount" | "requirements">,
  maxObservations: number = agentObservationBudget(state)
): AgentRemainingBudget => {
  const used = Math.max(0, state.observationCount)
  const remaining = Math.max(0, maxObservations - used)
  return {
    observationsUsed: used,
    observationsRemaining: remaining,
    maxObservations,
    stepsRemaining: remaining
  }
}

export interface AgentProgressPoint {
  url: string
  snapshotHash: string
  /**
   * The decision behind the point. Absent on a point restored from the
   * checkpoint, which keeps only its fingerprint.
   */
  decision?: AgentDecision
  /**
   * The decision as compared, hashed: refs replaced by the control they named
   * when the observation was at hand. Refs are positional, so a list that
   * gained a row renumbered the same button and the third click on it read
   * as a new action.
   */
  fingerprint?: string
  /**
   * What the page's visible text gained and lost since the previous point,
   * hashed; absent when it did not change or there is no previous point.
   *
   * A changed page is normally the run getting somewhere, which is why the
   * snapshot hash alone cannot see a run that repeats one action whose
   * effect *accumulates*: a canvas that appends a status line per click, a
   * button that adds the same toast each time. Every observation differs
   * from the last, yet each step made the same change as the one before it.
   * One run clicked the same point eighteen times after the first click had
   * already met the goal. A counter stepping 1 → 2 → 3 changes differently
   * each time and stays progress.
   */
  changeSignature?: string
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

/**
 * A control as the run would recognise it again on the next snapshot: its
 * frame, kind, name, destination and row, never its positional ref.
 */
const controlIdentity = (element: AgentElement): string =>
  JSON.stringify([
    element.frameId,
    element.tag,
    element.role ?? "",
    element.type ?? "",
    element.name ?? "",
    element.href ?? "",
    element.group ?? "",
    element.rowContext ?? ""
  ])

const keyedRefs = (
  command: Record<string, unknown>,
  observation: Pick<AgentObservation, "elements"> | undefined
): Record<string, unknown> => {
  if (!observation) return command
  const identity = (ref: unknown): unknown => {
    if (typeof ref !== "string") return ref
    const element = observation.elements.find((entry) => entry.ref === ref)
    return element ? controlIdentity(element) : ref
  }
  const keyed: Record<string, unknown> = { ...command }
  if ("ref" in keyed) keyed.ref = identity(keyed.ref)
  if ("to" in keyed) keyed.to = identity(keyed.to)
  if (Array.isArray(keyed.fields))
    keyed.fields = keyed.fields.map((field: unknown) =>
      field && typeof field === "object" && "ref" in field
        ? { ...field, ref: identity((field as { ref: unknown }).ref) }
        : field
    )
  return keyed
}

/**
 * What two decisions are compared by. With the observation the decision was
 * made on, each ref is replaced by the control it named.
 */
export const agentDecisionFingerprint = (
  decision: AgentDecision,
  observation?: Pick<AgentObservation, "elements">
): string => {
  if (decision.type === "complete") return fnv1a("complete")
  if (decision.type !== "command") return fnv1a(JSON.stringify(decision))
  const {
    snapshotId: _snapshotId,
    generation: _generation,
    ...command
  } = decision.command
  return fnv1a(
    JSON.stringify({
      type: "command",
      command: keyedRefs(command, observation)
    })
  )
}

const fingerprintOf = (point: AgentProgressPoint): string | undefined =>
  point.fingerprint ??
  (point.decision ? agentDecisionFingerprint(point.decision) : undefined)

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

/**
 * Ignore unrelated page churn for targeted reads, but never ignore a changed
 * answer.
 *
 * A visual read's answer is the picture. On a live canvas or chart the text
 * and the controls stay put while what is drawn changes, so `look` after
 * `look` hashed the same and a run watching a chart update was paused as
 * repeating itself. The picture the decision was shown is folded in for those
 * commands only — elsewhere a repainting video would pass a loop off as
 * progress — and only as a hash held in memory, never the image.
 */
export const hashAgentObservation = (
  observation: AgentObservation,
  decision?: AgentDecision,
  picture?: string
): string => {
  const command = decision?.type === "command" ? decision.command : undefined
  if (
    picture !== undefined &&
    (command?.type === "look" || command?.type === "zoom")
  )
    return fnv1a(
      `${hashAgentObservation(observation, decision)}${fnv1a(picture)}`
    )
  if (command?.type === "inspect" || command?.type === "find") {
    const focus =
      command.type === "inspect"
        ? { region: command.target }
        : { query: command.query }
    return fnv1a(
      JSON.stringify(
        observation.elements
          .filter((element) => matchesAgentInspection(element, focus))
          // Refs are positional within a snapshot; unrelated insertions can
          // renumber the same answer without making progress on the task.
          .map(
            ({ ref: _ref, verificationId: _verificationId, ...element }) =>
              element
          )
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

/**
 * The text an observation gained and lost relative to the one before it,
 * hashed, after stripping what the two share at either end. Only the
 * signature is kept, never the text.
 */
export const agentTextChangeSignature = (
  before: string | undefined,
  after: string
): string | undefined => {
  if (before === undefined || before === after) return undefined
  const shorter = Math.min(before.length, after.length)
  let start = 0
  while (start < shorter && before[start] === after[start]) start += 1
  let end = 0
  while (
    end < shorter - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end += 1
  return fnv1a(
    `${before.slice(start, before.length - end)}\u0000${after.slice(start, after.length - end)}`
  )
}

export const classifyNoProgress = (
  input: AgentNoProgressInput
): AgentNoProgressResult => {
  if (input.current.decision?.type === "command") {
    if (input.current.decision.command.type === "wait") {
      return { noProgress: false, count: input.previousCount ?? 0 }
    }
  }
  const candidates = input.recent ?? (input.previous ? [input.previous] : [])
  const change = input.current.changeSignature
  const current = fingerprintOf(input.current)
  const same = candidates.some(
    (previous) =>
      previous.url === input.current.url &&
      current !== undefined &&
      fingerprintOf(previous) === current &&
      (previous.snapshotHash === input.current.snapshotHash ||
        (change !== undefined && previous.changeSignature === change))
  )
  return {
    noProgress: same,
    count: same ? (input.previousCount ?? 0) + 1 : 0
  }
}
