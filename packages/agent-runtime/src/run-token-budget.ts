import type { AgentStepTelemetry } from "@ollama-client/contracts"

import type { AgentStepReadout } from "./ports"

/** Cumulative accounting ceiling. Per-request context/output caps still apply. */
export const MAX_AGENT_RUN_TOKENS = 1_000_000

/** Tokens one telemetry record accounts for, reported counts preferred. */
export const agentTelemetryTokens = (
  telemetry: AgentStepTelemetry | undefined
): number =>
  telemetry
    ? (telemetry.promptTokens ?? telemetry.promptTokensEstimated ?? 0) +
      (telemetry.outputTokens ?? 0) +
      (telemetry.reviewPromptTokens ?? 0) +
      (telemetry.reviewOutputTokens ?? 0)
    : 0

/** The same record with its token counts removed, once they are accounted elsewhere. */
export const withoutAgentTelemetryTokens = (
  telemetry: AgentStepTelemetry | undefined
): AgentStepTelemetry | undefined => {
  if (!telemetry) return undefined
  const {
    promptTokens: _prompt,
    promptTokensEstimated: _estimated,
    outputTokens: _output,
    reviewPromptTokens: _reviewPrompt,
    reviewOutputTokens: _reviewOutput,
    ...rest
  } = telemetry
  return Object.keys(rest).length ? rest : undefined
}

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
  return [...latest.values()].reduce(
    (total, receipt) => total + agentTelemetryTokens(receipt.telemetry),
    0
  )
}
