import { expect, it } from "vitest"
import type { AgentStepReadout } from "../ports"
import { agentRunTokens } from "../run-token-budget"

it("counts cumulative telemetry once per durable step, including review and fallback estimates", () => {
  const row = (
    stepId: string,
    sequence: number,
    telemetry: AgentStepReadout["telemetry"]
  ): AgentStepReadout => ({
    stepId,
    sequence,
    telemetry,
    status: "verified",
    runId: "r",
    at: sequence
  })
  expect(
    agentRunTokens([
      row("a", 1, { promptTokens: 10 }),
      row("a", 2, { promptTokens: 10, outputTokens: 3 }),
      row("b", 3, {
        promptTokensEstimated: 20,
        reviewPromptTokens: 5,
        reviewOutputTokens: 2
      })
    ])
  ).toBe(40)
})
