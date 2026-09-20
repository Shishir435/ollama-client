import { describe, expect, it } from "vitest"
import { classifyVerificationOutcome } from "../verification"

const evidence = { kind: "dom", summary: "checked", observedAt: 1 }

describe("verification outcomes", () => {
  it("maps confirmed to controller advancement", () => {
    expect(
      classifyVerificationOutcome({ outcome: "confirmed", evidence }, "low")
    ).toEqual({ type: "advance", stepStatus: "verified" })
  })

  it("maps negative to re-decision", () => {
    expect(
      classifyVerificationOutcome({ outcome: "negative", evidence }, "medium")
    ).toEqual({
      type: "redecide",
      stepStatus: "failed",
      retryAllowed: true
    })
  })

  it("permits retry after negative only when the action is safe", () => {
    expect(
      classifyVerificationOutcome({ outcome: "negative", evidence }, "critical")
    ).toMatchObject({ type: "pause", retryAllowed: false })
  })

  it("maps ambiguous to an uncertain step and paused run", () => {
    expect(
      classifyVerificationOutcome({ outcome: "ambiguous", evidence }, "low")
    ).toEqual({
      type: "pause",
      stepStatus: "uncertain",
      retryAllowed: false,
      reason: "unresolved_effect"
    })
  })

  it("never collapses ambiguous into negative", () => {
    const result = classifyVerificationOutcome(
      { outcome: "ambiguous", evidence },
      "low"
    )
    expect(result).not.toMatchObject({ type: "redecide" })
  })

  it("never collapses negative into ambiguous", () => {
    const result = classifyVerificationOutcome(
      { outcome: "negative", evidence },
      "low"
    )
    expect(result).not.toMatchObject({ stepStatus: "uncertain" })
  })
})
