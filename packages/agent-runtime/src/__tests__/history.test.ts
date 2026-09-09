import { describe, expect, it } from "vitest"

import {
  AGENT_HISTORY_MAX_STEPS,
  agentStepSourceUrl,
  agentStepTargetFrom,
  buildAgentHistory,
  currentAgentInspection,
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

  it("reduces a lone entry rather than exceeding its own bound", () => {
    const [entry] = buildAgentHistory(
      [
        step({
          sequence: 1,
          finding: "x".repeat(400),
          sourceUrl: "https://example.com/a",
          target: { ref: "e1", tag: "button", name: "Continue" }
        })
      ],
      { maxBytes: 80 }
    )
    // The bound is a bound. Keeping an entry it could not fit and sending it
    // anyway is how a small local model runs out of context.
    expect(entry).toEqual({ step: 1, action: "click", outcome: "confirmed" })
  })

  it("keeps as much of a lone entry as the bound allows", () => {
    const [entry] = buildAgentHistory(
      [
        step({
          sequence: 1,
          finding: "x".repeat(400),
          sourceUrl: "https://example.com/a"
        })
      ],
      { maxBytes: 120 }
    )
    expect(entry.finding).toBeUndefined()
    expect(entry.url).toBe("https://example.com/a")
  })

  it("strips secrets a page put in its own URL", () => {
    const [entry] = buildAgentHistory([
      step({
        sequence: 1,
        sourceUrl: "https://user:pass@Example.com/orders?token=abc#at=xyz"
      })
    ])
    expect(entry.url).toBe("https://example.com/orders")
  })

  it("strips a destination the command carried too", () => {
    expect(
      buildAgentHistory([
        step({
          sequence: 1,
          command: {
            type: "navigate",
            url: "https://example.com/pay?card=4111111111111111",
            snapshotId: "snapshot-1",
            generation: 1
          }
        })
      ])[0].action
    ).toBe("navigate to https://example.com/pay")
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

describe("agentStepSourceUrl", () => {
  it.each([
    ["https://user:pass@example.com/a", "https://example.com/a"],
    ["https://example.com/a?token=abc", "https://example.com/a"],
    ["https://example.com/a#access_token=abc", "https://example.com/a"],
    ["https://EXAMPLE.com/A", "https://example.com/A"],
    ["https://example.com", "https://example.com"],
    ["http://127.0.0.1:8080/x?y=1", "http://127.0.0.1:8080/x"]
  ])("reduces %s to its page identity", (given, expected) => {
    expect(agentStepSourceUrl(given)).toBe(expected)
  })

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "about:blank",
    "nope"
  ])("refuses %s outright", (given) => {
    expect(agentStepSourceUrl(given)).toBeUndefined()
  })

  it("bounds a path the page made long", () => {
    expect(
      agentStepSourceUrl(`https://example.com/${"p".repeat(600)}`)?.length
    ).toBe(300)
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

describe("currentAgentInspection", () => {
  it("derives a region focus from the latest inspect step", () => {
    const focus = currentAgentInspection([
      step({ sequence: 1 }),
      step({
        sequence: 2,
        stepId: "run-1:2",
        command: {
          type: "inspect",
          target: 'form "signup"',
          snapshotId: "snapshot-1",
          generation: 1
        }
      })
    ])
    expect(focus).toEqual({ region: 'form "signup"' })
  })

  it("derives a query focus from a find step", () => {
    const focus = currentAgentInspection([
      step({
        sequence: 1,
        stepId: "run-1:1",
        command: {
          type: "find",
          query: "submit",
          snapshotId: "snapshot-1",
          generation: 1
        }
      })
    ])
    expect(focus).toEqual({ query: "submit" })
  })

  it("asks for the whole document text when extract_text names no region", () => {
    const focus = currentAgentInspection([
      step({
        sequence: 1,
        stepId: "run-1:1",
        command: {
          type: "extract_text",
          snapshotId: "snapshot-1",
          generation: 1
        }
      })
    ])
    expect(focus).toEqual({ text: true })
  })

  it("clears once the latest step is no longer an inspection", () => {
    const focus = currentAgentInspection([
      step({
        sequence: 1,
        stepId: "run-1:1",
        command: {
          type: "inspect",
          target: 'form "a"',
          snapshotId: "snapshot-1",
          generation: 1
        }
      }),
      step({ sequence: 2, stepId: "run-1:2" })
    ])
    expect(focus).toBeUndefined()
  })
})
