import type {
  AgentCancellationSignal,
  AgentModelPort,
  AgentObservationPort
} from "@ollama-client/agent-runtime"
import {
  type AgentDecision,
  AgentDecisionSchema,
  type AgentObservation,
  AgentObservationSchema,
  type AgentRunState
} from "@ollama-client/contracts"

export interface AgentDryRunResult {
  observation: AgentObservation
  decision: AgentDecision
}

/** Produces a grounded proposal without resolving or executing any effect. */
export const proposeAgentDryRunStep = async (input: {
  state: AgentRunState
  model: AgentModelPort
  observation: AgentObservationPort
  signal: AgentCancellationSignal
}): Promise<AgentDryRunResult> => {
  const observed = AgentObservationSchema.parse(
    await input.observation.observe(
      {
        runId: input.state.id,
        tabId: input.state.controlledTabId,
        minimumGeneration: 0
      },
      input.signal
    )
  )
  const decision = AgentDecisionSchema.parse(
    await input.model.decide(
      { state: input.state, observation: observed },
      input.signal
    )
  )
  if (
    decision.type === "command" &&
    (decision.command.snapshotId !== observed.snapshotId ||
      decision.command.generation !== observed.generation)
  ) {
    throw new Error("Agent dry-run decision is not grounded in its observation")
  }
  return { observation: observed, decision }
}
