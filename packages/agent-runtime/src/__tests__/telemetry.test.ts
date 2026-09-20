import { describe, expect, it } from "vitest"

import { mergeAgentStepTelemetry } from "../telemetry"

describe("mergeAgentStepTelemetry", () => {
  /**
   * The pieces of one step are measured by different parts of the run and
   * arrive at different moments. A merge that overwrote would report only
   * whichever piece landed last.
   */
  it("adds up work each measurement saw", () => {
    expect(
      mergeAgentStepTelemetry(
        { observeMs: 180, observations: 1, promptTokens: 7_000 },
        { verifyMs: 940, observations: 2, promptTokens: 120 }
      )
    ).toEqual({
      observeMs: 180,
      verifyMs: 940,
      observations: 3,
      promptTokens: 7_120
    })
  })

  /**
   * numCtx describes the request, not the work. Summing it across a step's
   * two receipts would report a window twice the size of the one asked for.
   */
  it("takes the latest answer for what describes the request", () => {
    expect(
      mergeAgentStepTelemetry(
        { numCtx: 16_384, promptChars: 20_000 },
        { numCtx: 32_768 }
      )
    ).toEqual({ numCtx: 32_768, promptChars: 20_000 })
  })

  it("keeps the vision flag once an image has travelled", () => {
    expect(mergeAgentStepTelemetry({ vision: true }, { verifyMs: 5 })).toEqual({
      vision: true,
      verifyMs: 5
    })
  })

  /**
   * An unmeasured phase and a phase that took no time are different claims,
   * so absent must not become zero.
   */
  it("leaves an unmeasured phase unmeasured", () => {
    expect(mergeAgentStepTelemetry({ decideMs: 10 }, { verifyMs: 5 })).toEqual({
      decideMs: 10,
      verifyMs: 5
    })
    expect(mergeAgentStepTelemetry(undefined, undefined)).toBeUndefined()
    expect(mergeAgentStepTelemetry({ decideMs: 10 }, undefined)).toEqual({
      decideMs: 10
    })
    expect(mergeAgentStepTelemetry(undefined, { decideMs: 10 })).toEqual({
      decideMs: 10
    })
  })
})
