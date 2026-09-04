import { AgentMalformedDecisionError } from "@ollama-client/agent-runtime"
import {
  type AgentDecision,
  AgentDecisionSchema,
  type AgentObservation
} from "@ollama-client/contracts"
import type { ToolCall } from "@/lib/tools/types"

export const AGENT_DECISION_TOOL_NAME = "agent_decision"

export class AgentDecisionFormatError extends AgentMalformedDecisionError {
  constructor(message: string) {
    super(message)
    this.name = "AgentDecisionFormatError"
  }
}

const assertGroundedDecision = (
  decision: AgentDecision,
  observation: AgentObservation
): AgentDecision => {
  if (
    decision.type === "command" &&
    (decision.command.snapshotId !== observation.snapshotId ||
      decision.command.generation !== observation.generation)
  ) {
    throw new AgentDecisionFormatError(
      "The agent decision references a stale snapshot"
    )
  }
  return decision
}

/** Accept exactly one native tool call and no provider-specific response shape. */
export const parseAgentDecisionToolCalls = (
  calls: readonly ToolCall[],
  observation: AgentObservation
): AgentDecision => {
  if (calls.length !== 1) {
    throw new AgentDecisionFormatError(
      `Expected one agent decision, received ${calls.length}`
    )
  }
  const call = calls[0]
  if (call.name !== AGENT_DECISION_TOOL_NAME) {
    throw new AgentDecisionFormatError("The model called an unknown agent tool")
  }
  const parsed = AgentDecisionSchema.safeParse(call.arguments)
  if (!parsed.success) {
    throw new AgentDecisionFormatError("The model returned an invalid decision")
  }
  return assertGroundedDecision(parsed.data, observation)
}
