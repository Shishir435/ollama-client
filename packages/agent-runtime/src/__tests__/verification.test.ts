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

  it("sends the run back to look when its own action raised a dialog", () => {
    /**
     * A confirm() in a click handler blocks the renderer, so the page cannot
     * be asked what it received and delivery reads as unknown. The reason is
     * known and answerable — the next observation reports the dialog — so the
     * run looks again rather than stopping.
     */
    expect(
      classifyVerificationOutcome(
        {
          outcome: "negative",
          evidence: { kind: "dialog", summary: "held", observedAt: 1 }
        },
        "high",
        true
      )
    ).toEqual({ type: "redecide", stepStatus: "failed", retryAllowed: true })
  })

  it("does so even at critical risk, which is where the confirmation is", () => {
    /**
     * The stranding case. A negative at critical risk pauses, and an
     * ambiguous one pauses at any risk — between them, a button guarded by a
     * confirmation could never be got past, and a guarded button is exactly
     * where the risk is critical. Accepting the dialog still costs its own
     * approval, so nothing is waved through by continuing.
     */
    expect(
      classifyVerificationOutcome(
        {
          outcome: "ambiguous",
          evidence: { kind: "dialog", summary: "held", observedAt: 1 }
        },
        "critical",
        true
      ).type
    ).toBe("redecide")
  })

  it("pauses on the same outcome when no dialog explains it", () => {
    expect(
      classifyVerificationOutcome(
        {
          outcome: "ambiguous",
          evidence: { kind: "field", summary: "unclear", observedAt: 1 }
        },
        "critical"
      ).type
    ).toBe("pause")
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
