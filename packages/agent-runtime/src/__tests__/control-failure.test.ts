import { describe, expect, it } from "vitest"

import {
  AGENT_CONTROL_FAILURE_REASONS,
  AgentControlFailedError,
  agentObservationFailureMessage
} from "../control-failure"

describe("Agent control failure", () => {
  it("carries its reason and structural evidence", () => {
    const error = new AgentControlFailedError({
      reason: "observation_invalid",
      issues: [{ path: "elements.0.editable", code: "invalid_type" }]
    })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("AgentControlFailedError")
    expect(error.reason).toBe("observation_invalid")
    expect(error.issues).toEqual([
      { path: "elements.0.editable", code: "invalid_type" }
    ])
    expect(error.message).toContain("observation_invalid")
  })

  it("defaults to no evidence rather than inventing some", () => {
    expect(
      new AgentControlFailedError({ reason: "execution_failed" }).issues
    ).toEqual([])
  })

  it.each(
    AGENT_CONTROL_FAILURE_REASONS
  )("states a run-visible sentence for %s", (reason) => {
    const message = agentObservationFailureMessage(
      new AgentControlFailedError({ reason })
    )
    expect(message.length).toBeGreaterThan(0)
    expect(message.endsWith(".")).toBe(true)
  })

  it("distinguishes a page it cannot read from a snapshot it built wrongly", () => {
    expect(
      agentObservationFailureMessage(
        new AgentControlFailedError({ reason: "observation_build_failed" })
      )
    ).not.toBe(
      agentObservationFailureMessage(
        new AgentControlFailedError({ reason: "observation_invalid" })
      )
    )
  })

  it("keeps the unqualified sentence for anything untyped", () => {
    for (const value of [new Error("boom"), undefined, "failed"]) {
      expect(agentObservationFailureMessage(value)).toBe(
        "The current page could not be observed safely."
      )
    }
  })
})
