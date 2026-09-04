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

const VARIANT_FIELDS: Record<string, string> = {
  command: "command",
  ask_user: "question",
  complete: "summary",
  fail: "reason"
}

/**
 * The tool advertises one flat object covering every variant, so a model may
 * answer with the siblings it did not use — `summary: ""` beside a command,
 * say. The union's members are strict, and rejecting a usable decision over a
 * key the schema invited is not integrity, it is pedantry: only the field
 * belonging to the stated type is kept, and everything else about the answer
 * is still validated.
 */
const normalizeDecisionArguments = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const record = raw as Record<string, unknown>
  const field = VARIANT_FIELDS[String(record.type)]
  if (!field) return raw
  const value = record[field]
  return value === undefined
    ? { type: record.type }
    : { type: record.type, [field]: value }
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
  const parsed = AgentDecisionSchema.safeParse(
    normalizeDecisionArguments(call.arguments)
  )
  if (!parsed.success) {
    throw new AgentDecisionFormatError("The model returned an invalid decision")
  }
  return assertGroundedDecision(parsed.data, observation)
}
