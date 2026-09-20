import { describe, expect, it } from "vitest"

import { AgentGroundingError } from "../affordance"
import {
  AgentStaleObservationError,
  AgentUnreadablePageError,
  agentResolutionFailure
} from "../resolution-failure"

describe("agentResolutionFailure", () => {
  it("blames the decision only when the decision was refused", () => {
    expect(
      agentResolutionFailure(
        new AgentGroundingError({
          refusal: { reason: "radio_uncheck", ref: "e1" }
        })
      )
    ).toEqual({
      code: "invalid_decision",
      message: expect.stringContaining("cannot be unchecked")
    })
  })

  it.each([
    [new AgentStaleObservationError(), "stale_snapshot"],
    [new AgentUnreadablePageError(), "unsupported_page"]
  ])("does not blame the decision for %s", (error, code) => {
    // The page moved or closed under a sound decision. Reporting that as a
    // bad model made every diagnostic read as the model's fault.
    expect(agentResolutionFailure(error)).toMatchObject({ code })
  })

  it("keeps the existing code for a failure it does not recognize", () => {
    for (const value of [new Error("boom"), undefined, "no"]) {
      expect(agentResolutionFailure(value)).toEqual({
        code: "verification_failed",
        message: "The proposed page effect could not be resolved safely."
      })
    }
  })

  it("carries a message for every code it returns", () => {
    for (const value of [
      new AgentGroundingError({ refusal: { reason: "unknown_ref" } }),
      new AgentStaleObservationError(),
      new AgentUnreadablePageError(),
      new Error("boom")
    ]) {
      const failure = agentResolutionFailure(value)
      expect(failure.message.length).toBeGreaterThan(0)
      expect(failure.message.endsWith(".")).toBe(true)
    }
  })
})
