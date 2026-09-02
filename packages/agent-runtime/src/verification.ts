import type { AgentRisk, AgentVerificationResult } from "./ports"

export type AgentVerificationAction =
  | { type: "advance"; stepStatus: "verified" }
  | { type: "redecide"; stepStatus: "failed"; retryAllowed: true }
  | {
      type: "pause"
      stepStatus: "failed" | "uncertain"
      retryAllowed: false
      reason: "critical_effect" | "unresolved_effect"
    }

export const classifyVerificationOutcome = (
  result: AgentVerificationResult,
  risk: AgentRisk
): AgentVerificationAction => {
  switch (result.outcome) {
    case "confirmed":
      return { type: "advance", stepStatus: "verified" }
    case "negative":
      return risk === "critical"
        ? {
            type: "pause",
            stepStatus: "failed",
            retryAllowed: false,
            reason: "critical_effect"
          }
        : { type: "redecide", stepStatus: "failed", retryAllowed: true }
    case "ambiguous":
      return {
        type: "pause",
        stepStatus: "uncertain",
        retryAllowed: false,
        reason: "unresolved_effect"
      }
  }
}
