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
  risk: AgentRisk,
  /** The action raised a dialog, which is why its effect cannot be judged. */
  heldByDialog = false
): AgentVerificationAction => {
  /**
   * A dialog the action itself raised is answerable, so the run looks again
   * rather than stopping. The next observation reports the dialog and the
   * model decides whether to accept it — under the approval that accepting
   * one already costs, so nothing is waved through here.
   *
   * Checked before risk, deliberately. An ambiguous outcome pauses and a
   * negative one at critical risk pauses too, which between them stranded the
   * ordinary case of a button guarded by a confirmation — and a guarded
   * button is precisely where the risk is critical. The run never even saw
   * the dialog it had caused.
   */
  if (heldByDialog) {
    return { type: "redecide", stepStatus: "failed", retryAllowed: true }
  }
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
