import {
  agentCommittedEffects,
  agentInheritedEffects,
  buildAgentEvidenceLedger,
  isTerminalAgentStatus
} from "@ollama-client/agent-runtime"
import type {
  AgentFollowUpMode,
  AgentPreviousRun
} from "@ollama-client/contracts"

import { buildAgentConversationHandoff } from "@/lib/repositories/agent-run-handoff"
import type {
  DurableAgentRun,
  DurableAgentStep
} from "@/lib/repositories/agent-runs"

export interface AgentFollowUpRequest {
  parentRunId: string
  mode: AgentFollowUpMode
}

/** Why a follow-up cannot be built from the run it names. */
export type AgentFollowUpRefusal =
  | "missing"
  | "unsettled"
  | "other_chat"
  | "unreadable"
  | "too_many_effects"

export type AgentFollowUpResolution =
  | { ok: true; previousRun: AgentPreviousRun }
  | { ok: false; reason: AgentFollowUpRefusal }

/** The run's own notes in the order it took them, one per step. */
const stepFindings = (steps: readonly DurableAgentStep[]): string[] => {
  const latest = new Map<string, string>()
  for (const step of [...steps].sort((a, b) => a.sequence - b.sequence)) {
    if (!step.finding) continue
    latest.delete(step.stepId)
    latest.set(step.stepId, step.finding)
  }
  return [...latest.values()]
}

/**
 * What a follow-up carries from the run it follows, read from that run's own
 * durable rows at the moment the follow-up starts.
 *
 * The panel names a run and never supplies what it did: a record the page
 * side assembled could leave out the payment a retry must not make again.
 * Everything here comes from the parent's checkpoint and receipts.
 *
 * Refused rather than weakened. A parent that is gone, still live, in
 * another chat, or whose receipts cannot be read gives no honest answer to
 * "what has already been done", and a follow-up that guessed would be the
 * one that repeats it. Nor is a chain that committed more than a follow-up
 * can carry trimmed to fit: the effect trimmed off is the one it could
 * repeat. Starting over is always available instead: it is a
 * fresh run that claims to know nothing.
 */
export const resolveAgentFollowUp = async (
  request: AgentFollowUpRequest,
  sessionId: string | undefined,
  read: {
    run: (runId: string) => Promise<DurableAgentRun | null>
    steps: (runId: string) => Promise<DurableAgentStep[]>
  }
): Promise<AgentFollowUpResolution> => {
  let parent: DurableAgentRun | null
  let steps: DurableAgentStep[]
  try {
    parent = await read.run(request.parentRunId)
    if (!parent?.state) return { ok: false, reason: "missing" }
    if (!isTerminalAgentStatus(parent.state.status))
      return { ok: false, reason: "unsettled" }
    if (parent.sessionId && parent.sessionId !== sessionId)
      return { ok: false, reason: "other_chat" }
    steps = await read.steps(parent.id)
  } catch {
    return { ok: false, reason: "unreadable" }
  }

  const handoff = buildAgentConversationHandoff(
    parent.state,
    stepFindings(steps),
    buildAgentEvidenceLedger(
      [
        ...steps,
        {
          runId: parent.id,
          stepId: "answer",
          status: "verified",
          at: parent.state.updatedAt,
          sequence: steps.length,
          evidenceLedger: parent.state.evidenceLedger
        }
      ],
      parent.state.allowedOrigins
    )
  )
  if (!handoff) return { ok: false, reason: "unreadable" }
  const effects = agentInheritedEffects(
    parent.state.previousRun?.effects ?? [],
    agentCommittedEffects(steps)
  )
  if (!effects) return { ok: false, reason: "too_many_effects" }
  return {
    ok: true,
    previousRun: {
      mode: request.mode,
      handoff,
      effects,
      ...previousRequirements(parent.state)
    }
  }
}

/**
 * The parent's plan by id, each with what its settled outcome said of it, so
 * the follow-up's planner can keep an id for the same outcome. Absent when
 * the parent was never planned; `met` absent where the parent settled
 * without judging that requirement (a failure, a stop).
 */
const previousRequirements = (
  state: NonNullable<DurableAgentRun["state"]>
): Pick<AgentPreviousRun, "requirements" | "constraints"> => {
  /** Every user boundary travels with the chain, including scope and limits. */
  const constraints = state.constraints?.length
    ? { constraints: state.constraints }
    : {}
  if (!state.requirements?.length) return constraints
  const met = new Set(state.outcome?.met ?? [])
  const unmet = new Set(state.outcome?.unmet ?? [])
  return {
    ...constraints,
    requirements: state.requirements.map(({ id, text, kind, check }) => ({
      id,
      text,
      kind,
      ...(check ? { check } : {}),
      ...(met.has(id) ? { met: true } : unmet.has(id) ? { met: false } : {})
    }))
  }
}
