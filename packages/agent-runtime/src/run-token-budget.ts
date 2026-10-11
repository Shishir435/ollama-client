import type { AgentStepReadout } from "./ports"

/** Cumulative accounting ceiling. Per-request context/output caps still apply. */
export const MAX_AGENT_RUN_TOKENS = 1_000_000

/** A step's latest receipt already contains its cumulative telemetry. */
export const agentRunTokens = (
  receipts: readonly AgentStepReadout[]
): number => {
  const latest = new Map<string, AgentStepReadout>()
  for (const receipt of receipts) {
    const previous = latest.get(receipt.stepId)
    if (!previous || receipt.sequence > previous.sequence)
      latest.set(receipt.stepId, receipt)
  }
  return [...latest.values()].reduce((total, receipt) => {
    const telemetry = receipt.telemetry
    if (!telemetry) return total
    return (
      total +
      (telemetry.promptTokens ?? telemetry.promptTokensEstimated ?? 0) +
      (telemetry.outputTokens ?? 0) +
      (telemetry.reviewPromptTokens ?? 0) +
      (telemetry.reviewOutputTokens ?? 0)
    )
  }, 0)
}
