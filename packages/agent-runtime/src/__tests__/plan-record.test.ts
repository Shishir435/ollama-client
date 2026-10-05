import type { AgentRunState } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  agentAmendedPlanPatch,
  agentForbiddingConstraints,
  agentInitialPlanPatch,
  agentPlanNeedsReconciling
} from "../plan-record"

const planned: Pick<AgentRunState, "plan" | "requirements" | "constraints"> = {
  requirements: [
    { id: "r1", text: "the name is Alice", kind: "change" },
    { id: "r2", text: "the form is saved", kind: "change", since: 1 }
  ],
  constraints: [
    {
      id: "c1",
      text: "do not submit",
      kind: "exclude",
      forbids: ["submission"]
    }
  ],
  plan: {
    version: 1,
    issued: { requirements: 2, constraints: 1 },
    reconciledThrough: 5
  }
}

describe("agent plan record", () => {
  it("counts every answer given before planning as reconciled", () => {
    expect(
      agentInitialPlanPatch(
        {
          answers: [
            { questionId: "q1", text: "The work account", answeredAt: 3 }
          ]
        },
        { requirements: [{ id: "r1", text: "signed in", kind: "change" }] }
      ).plan
    ).toEqual({
      version: 1,
      issued: { requirements: 1, constraints: 0 },
      reconciledThrough: 3
    })
  })

  it("asks for reconciling only when the user said something newer", () => {
    const answer = (answeredAt: number) => [
      { questionId: "q", text: "ok", answeredAt }
    ]
    expect(agentPlanNeedsReconciling(planned, answer(5))).toBeUndefined()
    expect(agentPlanNeedsReconciling(planned, answer(6))).toBe(6)
    /** A run planned before the record existed is never re-planned. */
    expect(
      agentPlanNeedsReconciling({ ...planned, plan: undefined }, answer(6))
    ).toBeUndefined()
  })

  it("marks an answer that changed nothing reconciled, without a version", () => {
    const patch = agentAmendedPlanPatch(
      planned,
      {
        requirements: planned.requirements ?? [],
        constraints: planned.constraints
      },
      9,
      10
    )
    expect(patch).toEqual({
      plan: { ...planned.plan, reconciledThrough: 9 }
    })
  })

  it("keeps the plan in force when the amendment produced nothing", () => {
    expect(agentAmendedPlanPatch(planned, { requirements: [] }, 9, 10)).toEqual(
      {
        plan: { ...planned.plan, reconciledThrough: 9 }
      }
    )
  })

  it("versions a change, stamps what it added and records what it removed", () => {
    const patch = agentAmendedPlanPatch(
      planned,
      {
        requirements: [
          { id: "r2", text: "the form is saved", kind: "change" },
          { id: "r3", text: "the email is set", kind: "change" }
        ]
      },
      9,
      10
    )
    expect(patch.requirements).toEqual([
      { id: "r2", text: "the form is saved", kind: "change", since: 1 },
      { id: "r3", text: "the email is set", kind: "change", since: 2 }
    ])
    expect(patch.constraints).toEqual([])
    expect(patch.plan).toEqual({
      version: 2,
      issued: { requirements: 3, constraints: 1 },
      reconciledThrough: 9,
      amendments: [
        {
          version: 2,
          answeredAt: 9,
          added: ["r3"],
          removed: ["r1", "c1"],
          at: 10
        }
      ]
    })
  })

  it("names the constraints an effect would break, by class", () => {
    expect(
      agentForbiddingConstraints(
        { semanticEffects: ["activation", "submission"] },
        planned.constraints
      )
    ).toEqual([
      { constraint: planned.constraints?.[0], effects: ["submission"] }
    ])
    expect(
      agentForbiddingConstraints(
        { semanticEffects: ["read"] },
        planned.constraints
      )
    ).toEqual([])
  })
})
