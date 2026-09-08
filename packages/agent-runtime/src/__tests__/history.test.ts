import { describe, expect, it } from "vitest"

import {
  AGENT_HISTORY_MAX_STEPS,
  agentStepTargetFrom,
  buildAgentHistory,
  previousAgentVerification
} from "../history"
import type {
  AgentStepReadout,
  AgentVerificationResult,
  ResolvedAgentTarget
} from "../ports"

const verification = (
  outcome: AgentVerificationResult["outcome"],
  summary = "Observed"
): AgentVerificationResult => ({
  outcome,
  evidence: { kind: "field", summary, observedAt: 1 }
})

const step = (
  overrides: Partial<AgentStepReadout> & { sequence: number }
): AgentStepReadout => ({
  runId: "run-1",
  stepId: `run-1:${overrides.sequence}`,
  status: "verified",
  at: overrides.sequence,
  command: {
    type: "click",
    ref: "e1",
    snapshotId: "snapshot-1",
    generation: 1
  },
  verification: verification("confirmed"),
  ...overrides
})

describe("buildAgentHistory", () => {
  it("keeps one entry per step, carrying what the last receipt knew", () => {
    const history = buildAgentHistory([
      step({
        sequence: 1,
        stepId: "run-1:1",
        status: "planned",
        verification: undefined,
        target: { ref: "e1", tag: "button", name: "Continue" },
        sourceUrl: "https://example.com/"
      }),
      step({
        sequence: 2,
        stepId: "run-1:1",
        status: "verified",
        command: undefined,
        target: undefined
      })
    ])

    expect(history).toEqual([
      {
        step: 1,
        action: "click",
        outcome: "confirmed",
        target: { ref: "e1", tag: "button", name: "Continue" },
        url: "https://example.com/",
        evidence: "Observed"
      }
    ])
  })

  it.each([
    [
      "verified with a confirmation",
      "verified",
      verification("confirmed"),
      "confirmed"
    ],
    [
      "verified with a negative",
      "verified",
      verification("negative"),
      "failed"
    ],
    [
      "verified with an ambiguity",
      "verified",
      verification("ambiguous"),
      "uncertain"
    ],
    ["executed without one", "executed", undefined, "planned"],
    ["rejected", "rejected", undefined, "rejected"],
    ["failed", "failed", undefined, "failed"],
    ["uncertain", "uncertain", undefined, "uncertain"]
  ])("reports %s as %s", (_label, status, verified, outcome) => {
    expect(
      buildAgentHistory([
        step({
          sequence: 1,
          status: status as AgentStepReadout["status"],
          verification: verified
        })
      ])[0].outcome
    ).toBe(outcome)
  })

  it("never presents an attempt as a completed step", () => {
    const outcomes = buildAgentHistory([
      step({ sequence: 1, status: "executed", verification: undefined }),
      step({ sequence: 2, stepId: "run-1:2", status: "uncertain" })
    ]).map((entry) => entry.outcome)
    expect(outcomes).not.toContain("confirmed")
  })

  it("drops the oldest steps beyond the step bound", () => {
    const steps = Array.from({ length: AGENT_HISTORY_MAX_STEPS + 4 }, (_v, i) =>
      step({ sequence: i + 1, stepId: `run-1:${i + 1}` })
    )
    const history = buildAgentHistory(steps)
    expect(history).toHaveLength(AGENT_HISTORY_MAX_STEPS)
    expect(history[0].step).toBe(5)
    expect(history.at(-1)?.step).toBe(AGENT_HISTORY_MAX_STEPS + 4)
  })

  it("drops the oldest steps beyond the byte bound, deterministically", () => {
    const steps = Array.from({ length: 8 }, (_v, i) =>
      step({
        sequence: i + 1,
        stepId: `run-1:${i + 1}`,
        finding: `f${i}`.padEnd(200, "x")
      })
    )
    const first = buildAgentHistory(steps, { maxBytes: 1_200 })
    const second = buildAgentHistory(steps, { maxBytes: 1_200 })
    expect(first).toEqual(second)
    expect(first.length).toBeLessThan(8)
    // Oldest first, so the newest step always survives.
    expect(first.at(-1)?.step).toBe(8)
  })

  it("keeps one entry even when it alone exceeds the byte bound", () => {
    expect(
      buildAgentHistory([step({ sequence: 1, finding: "x".repeat(400) })], {
        maxBytes: 10
      })
    ).toHaveLength(1)
  })

  it("orders by durable sequence, not by arrival", () => {
    const history = buildAgentHistory([
      step({ sequence: 3, stepId: "run-1:3" }),
      step({ sequence: 1, stepId: "run-1:1" }),
      step({ sequence: 2, stepId: "run-1:2" })
    ])
    expect(history.map((entry) => entry.step)).toEqual([1, 2, 3])
  })

  it("names a destination the ref cannot describe later", () => {
    expect(
      buildAgentHistory([
        step({
          sequence: 1,
          command: {
            type: "navigate",
            url: "https://example.com/next",
            snapshotId: "snapshot-1",
            generation: 1
          }
        })
      ])[0].action
    ).toBe("navigate to https://example.com/next")
  })
})

describe("previousAgentVerification", () => {
  it("is the outcome of the last settled step", () => {
    expect(
      previousAgentVerification([
        step({ sequence: 1, stepId: "run-1:1" }),
        step({
          sequence: 2,
          stepId: "run-1:2",
          verification: verification("ambiguous", "Nothing changed")
        })
      ])
    ).toMatchObject({ outcome: "ambiguous" })
  })

  it("is nothing before any step has settled", () => {
    expect(
      previousAgentVerification([
        step({ sequence: 1, status: "planned", verification: undefined })
      ])
    ).toBeUndefined()
    expect(previousAgentVerification([])).toBeUndefined()
  })
})

describe("agentStepTargetFrom", () => {
  const target = (
    overrides: Partial<ResolvedAgentTarget> = {}
  ): ResolvedAgentTarget => ({
    ref: "e1",
    tag: "input",
    role: "textbox",
    accessibleName: "Email",
    sensitive: false,
    maySubmit: false,
    ...overrides
  })

  it("keeps what a later snapshot can still recognize", () => {
    expect(agentStepTargetFrom(target())).toEqual({
      ref: "e1",
      tag: "input",
      role: "textbox",
      name: "Email"
    })
  })

  it("drops the name of a sensitive control and keeps its shape", () => {
    // The label of a password field is page text about a secret, and history
    // is read back into a prompt.
    expect(
      agentStepTargetFrom(
        target({ sensitive: true, accessibleName: "Password" })
      )
    ).toEqual({ ref: "e1", tag: "input", role: "textbox" })
  })

  it("bounds a name the page made long", () => {
    expect(
      agentStepTargetFrom(target({ accessibleName: "n".repeat(400) }))?.name
    ).toHaveLength(120)
  })

  it("reports nothing for a target with no structure", () => {
    expect(
      agentStepTargetFrom({ sensitive: false, maySubmit: false })
    ).toBeUndefined()
  })
})
