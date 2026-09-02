import type { AgentEvent, AgentRunState } from "@ollama-client/contracts"
import { isLegalAgentTransition } from "./state"

export const reduceAgentState = (
  state: AgentRunState,
  event: AgentEvent
): AgentRunState => {
  if (event.runId !== state.id) return state

  switch (event.type) {
    case "status_changed":
      if (
        event.from !== state.status ||
        !isLegalAgentTransition(event.from, event.to)
      ) {
        throw new Error(
          `Illegal agent transition: ${event.from} -> ${event.to}`
        )
      }
      return { ...state, status: event.to, updatedAt: event.at }
    case "pause_requested":
      if (!isLegalAgentTransition(state.status, "pause_requested")) {
        throw new Error(`Cannot pause agent from ${state.status}`)
      }
      return {
        ...state,
        status: "pause_requested",
        pauseReason: event.reason,
        updatedAt: event.at
      }
    case "failed":
      if (!isLegalAgentTransition(state.status, "failed")) {
        throw new Error(`Cannot fail agent from ${state.status}`)
      }
      return {
        ...state,
        status: "failed",
        error: event.error,
        updatedAt: event.at
      }
    case "approval_requested":
    case "decision_received":
    case "takeover_requested":
      return { ...state, updatedAt: event.at }
  }
}
