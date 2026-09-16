import { describe, expect, it } from "vitest"

import {
  AgentStepTelemetrySchema,
  agentStepTelemetry,
  agentTelemetryMillis
} from "../agent-telemetry"

describe("Agent step telemetry", () => {
  it("keeps reported and estimated token counts as separate fields", () => {
    const parsed = AgentStepTelemetrySchema.parse({
      promptTokens: 7_412,
      promptTokensEstimated: 7_100
    })
    expect(parsed.promptTokens).toBe(7_412)
    expect(parsed.promptTokensEstimated).toBe(7_100)
  })

  it("refuses anything that is not a bounded whole number", () => {
    expect(() => AgentStepTelemetrySchema.parse({ decideMs: -1 })).toThrow()
    expect(() => AgentStepTelemetrySchema.parse({ decideMs: 1.5 })).toThrow()
    expect(() =>
      AgentStepTelemetrySchema.parse({ decideMs: 86_400_001 })
    ).toThrow()
  })

  /**
   * The receipt is read back into a prompt and lifted by the debug report, so
   * a field carrying page text would travel further than page text may.
   */
  it("refuses a field the schema does not name", () => {
    expect(() =>
      AgentStepTelemetrySchema.parse({ decideMs: 10, prompt: "the page said" })
    ).toThrow()
  })

  it("converts the runner's nanoseconds, and answers nothing for nothing", () => {
    expect(agentTelemetryMillis(1_500_000)).toBe(2)
    expect(agentTelemetryMillis(0)).toBe(0)
    expect(agentTelemetryMillis(undefined)).toBeUndefined()
    expect(agentTelemetryMillis(-1)).toBeUndefined()
    expect(agentTelemetryMillis(Number.NaN)).toBeUndefined()
  })

  it("drops absent fields rather than writing undefined into a strict shape", () => {
    expect(
      agentStepTelemetry({ decideMs: 900, promptTokens: undefined })
    ).toEqual({ decideMs: 900 })
  })

  /**
   * A step that measured nothing gets no record at all. An empty object on
   * every receipt is bytes with no reader, and it would read as a measured
   * zero rather than as unmeasured.
   */
  it("returns nothing when a step measured nothing", () => {
    expect(agentStepTelemetry({})).toBeUndefined()
    expect(agentStepTelemetry({ decideMs: undefined })).toBeUndefined()
  })
})
