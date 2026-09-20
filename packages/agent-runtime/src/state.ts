import type { AgentRunState, AgentRunStatus } from "@ollama-client/contracts"

export const TERMINAL_AGENT_STATUSES = [
  "completed",
  "partial",
  "failed",
  "cancelled"
] as const satisfies readonly AgentRunStatus[]

/**
 * Legal lifecycle predecessors, stored in the same direction used by a SQL
 * compare-and-set. A transition not named here must fail closed.
 */
export const AGENT_STATUS_PREDECESSORS = {
  submitted: [],
  /** One model call, before the run is allowed to look at anything. */
  planning: ["submitted"],
  /**
   * `deciding` is here because a decision can now be declined without
   * anything happening to the page: a completion the run cannot support is a
   * safe failure, so the run goes back to looking rather than ending. Every
   * other way out of `deciding` still runs through a step.
   */
  observing: [
    "submitted",
    "planning",
    "deciding",
    "verifying",
    "paused",
    "awaiting_takeover"
  ],
  deciding: ["observing"],
  awaiting_approval: ["deciding"],
  awaiting_takeover: ["deciding", "awaiting_approval"],
  executing: ["awaiting_approval"],
  verifying: ["executing"],
  pause_requested: [
    "submitted",
    "planning",
    "observing",
    "deciding",
    "awaiting_approval",
    "awaiting_takeover",
    "executing",
    "verifying"
  ],
  paused: [
    "pause_requested",
    "awaiting_approval",
    "awaiting_takeover",
    "verifying"
  ],
  cancelling: [
    "submitted",
    "planning",
    "observing",
    "deciding",
    "awaiting_approval",
    "awaiting_takeover",
    "executing",
    "verifying",
    "pause_requested",
    "paused"
  ],
  completed: ["deciding", "cancelling"],
  /**
   * Only from `deciding`, and only on the model's own word that an outcome
   * was not met. A cancelled or failed run is not a partial one: partial
   * means the run reached an answer and the answer was "some of it".
   */
  partial: ["deciding"],
  failed: [
    "submitted",
    "planning",
    "observing",
    "deciding",
    "awaiting_approval",
    "awaiting_takeover",
    "executing",
    "verifying",
    "pause_requested",
    "paused",
    "cancelling"
  ],
  cancelled: ["cancelling"]
} as const satisfies Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>>

export const isLegalAgentTransition = (
  from: AgentRunStatus,
  to: AgentRunStatus
): boolean =>
  (AGENT_STATUS_PREDECESSORS[to] as readonly AgentRunStatus[]).includes(from)

export const isTerminalAgentStatus = (status: AgentRunStatus): boolean =>
  (TERMINAL_AGENT_STATUSES as readonly AgentRunStatus[]).includes(status)

/**
 * The tabs a run may drive. The controlled tab is always in scope, so a row
 * written before scope existed, or one whose scope filled up, still names the
 * tab the run is on.
 */
export const agentTabScope = (
  state: Pick<AgentRunState, "controlledTabId" | "scopedTabIds">
): readonly number[] => [
  ...new Set([state.controlledTabId, ...(state.scopedTabIds ?? [])])
]
