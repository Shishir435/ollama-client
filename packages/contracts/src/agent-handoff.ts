/**
 * The handoff a settled run leaves in its chat row. Defined beside the run
 * state in `./agent`, because a follow-up run carries its parent's handoff in
 * that state and the reverse import would be a cycle; re-exported here so
 * the chat side keeps importing it by the name of what it is.
 */
export {
  AGENT_HANDOFF_STATUSES,
  type AgentConversationHandoff,
  AgentConversationHandoffSchema,
  MAX_AGENT_HANDOFF_CHARS,
  MAX_AGENT_HANDOFF_FINDINGS,
  MAX_AGENT_HANDOFF_GOAL_CHARS,
  MAX_AGENT_HANDOFF_RESULT_CHARS
} from "./agent"
