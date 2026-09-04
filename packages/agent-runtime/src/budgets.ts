import {
  type AgentDeadlineState,
  AgentDeadlineStateSchema,
  type AgentDecision,
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
  kind: "approval" | "takeover",
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

export interface AgentBudgetInput {
  now: () => number
  maxActiveMs?: number
  maxStepMs?: number
  maxMalformedDecisions?: number
}

export interface AgentBudgetSnapshot {
  activeRuntimeMs: number
  activeStepMs: number
  malformedDecisions: number
  runExpired: boolean
  stepExpired: boolean
  malformedBudgetExhausted: boolean
}

export interface AgentBudgetTracker {
  beginStep(): void
  suspend(kind: "approval" | "takeover"): void
  resume(): void
  recordMalformedDecision(): boolean
  snapshot(): AgentBudgetSnapshot
}

export const createAgentBudgetTracker = (
  input: AgentBudgetInput
): AgentBudgetTracker => {
  const maxActiveMs = input.maxActiveMs ?? 10 * 60_000
  const maxStepMs = input.maxStepMs ?? 60_000
  const maxMalformedDecisions = input.maxMalformedDecisions ?? 5
  const startedAt = input.now()
  let stepStartedAt = startedAt
  let suspendedAt: number | undefined
  let runSuspendedMs = 0
  let stepSuspendedMs = 0
  let malformedDecisions = 0

  const elapsed = (start: number, suspended: number): number => {
    const currentPause =
      suspendedAt === undefined ? 0 : input.now() - suspendedAt
    return Math.max(0, input.now() - start - suspended - currentPause)
  }

  return {
    beginStep() {
      stepStartedAt = input.now()
      stepSuspendedMs = 0
    },
    suspend() {
      suspendedAt ??= input.now()
    },
    resume() {
      if (suspendedAt === undefined) return
      const duration = input.now() - suspendedAt
      runSuspendedMs += duration
      stepSuspendedMs += duration
      suspendedAt = undefined
    },
    recordMalformedDecision() {
      malformedDecisions += 1
      return malformedDecisions >= maxMalformedDecisions
    },
    snapshot() {
      const activeRuntimeMs = elapsed(startedAt, runSuspendedMs)
      const activeStepMs = elapsed(stepStartedAt, stepSuspendedMs)
      return {
        activeRuntimeMs,
        activeStepMs,
        malformedDecisions,
        runExpired: activeRuntimeMs >= maxActiveMs,
        stepExpired: activeStepMs >= maxStepMs,
        malformedBudgetExhausted: malformedDecisions >= maxMalformedDecisions
      }
    }
  }
}

export interface AgentProgressPoint {
  url: string
  snapshotHash: string
  decision: AgentDecision
}

export interface AgentNoProgressInput {
  previous?: AgentProgressPoint
  current: AgentProgressPoint
  previousCount?: number
  verificationOutcome?: "confirmed" | "negative" | "ambiguous"
}

export interface AgentNoProgressResult {
  noProgress: boolean
  count: number
}

const decisionFingerprint = (decision: AgentDecision): string => {
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

/** Snapshot identity and capture time change on every observation and are not progress. */
export const hashAgentObservation = (observation: AgentObservation): string =>
  fnv1a(
    JSON.stringify({
      url: observation.url,
      title: observation.title,
      elements: observation.elements,
      visibleText: observation.visibleText,
      scroll: observation.scroll,
      dialogs: observation.dialogs
    })
  )

export const classifyNoProgress = (
  input: AgentNoProgressInput
): AgentNoProgressResult => {
  if (input.verificationOutcome === "confirmed") {
    return { noProgress: false, count: 0 }
  }
  if (input.current.decision.type === "command") {
    if (input.current.decision.command.type === "wait") {
      return { noProgress: false, count: input.previousCount ?? 0 }
    }
  }
  const same =
    input.previous !== undefined &&
    input.previous.url === input.current.url &&
    input.previous.snapshotHash === input.current.snapshotHash &&
    decisionFingerprint(input.previous.decision) ===
      decisionFingerprint(input.current.decision)
  return {
    noProgress: same,
    count: same ? (input.previousCount ?? 0) + 1 : 0
  }
}
