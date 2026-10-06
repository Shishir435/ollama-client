import type { AgentRunState } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  agentAmendedPlanPatch,
  agentConfirmedRemovalPatch,
  agentForbiddingConstraints,
  agentInitialPlanPatch,
  agentPlanNeedsReconciling
} from "../plan-record"

const planned: Pick<
  AgentRunState,
  "id" | "plan" | "requirements" | "constraints"
> = {
  id: "run-1",
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

  describe("confirmed removal", () => {
    const pending = {
      ...planned,
      requirements: [
        {
          id: "r1",
          text: "each invoice shows Paid",
          kind: "change" as const,
          items: ["invoice 1", "invoice 2"]
        },
        ...(planned.requirements ?? []).slice(1)
      ],
      plan: {
        ...(planned.plan as NonNullable<AgentRunState["plan"]>),
        pending: {
          questionId: "run-1:removal:9",
          removals: [{ id: "r1", item: "invoice 1" }, { id: "c1" }]
        }
      }
    }

    it("removes the named entries and items on a plain yes", () => {
      const patch = agentConfirmedRemovalPatch(pending, "Yes, please", 12, 13)
      expect(patch.requirements?.[0]?.items).toEqual(["invoice 2"])
      expect(patch.constraints).toEqual([])
      expect(patch.plan).toMatchObject({
        version: 2,
        reconciledThrough: 12,
        amendments: [
          {
            removed: ["c1"],
            removedItems: [{ id: "r1", item: "invoice 1" }]
          }
        ]
      })
      expect(patch.plan?.pending).toBeUndefined()
    })

    it.each([
      ["de", "Ja", "Nein"],
      ["en", "yes", "no"],
      ["es", "sí", "no"],
      ["fr", "oui", "non"],
      ["hi", "हाँ", "नहीं"],
      ["it", "sì", "no"],
      ["ja", "はい", "いいえ"],
      ["ru", "да", "нет"],
      ["zh", "是", "否"]
    ])("accepts the %s prompt's plain replies", (_locale, yes, no) => {
      const removed = agentConfirmedRemovalPatch(pending, yes, 12, 13)
      expect(removed.requirements?.[0]?.items).toEqual(["invoice 2"])
      expect(removed.plan?.reconciledThrough).toBe(12)
      expect(agentConfirmedRemovalPatch(pending, no, 12, 13)).toEqual({
        plan: { ...planned.plan, reconciledThrough: 12 }
      })
      expect(
        agentConfirmedRemovalPatch(pending, `${yes} but keep invoice 1`, 12, 13)
      ).toEqual({ plan: planned.plan })
    })

    it.each([
      "sí",
      "sì",
      "हाँ",
      "नहीं"
    ])("preserves combining marks in %s", (answer) => {
      expect(
        agentConfirmedRemovalPatch(pending, answer.normalize("NFD"), 12, 13)
      ).toEqual(agentConfirmedRemovalPatch(pending, answer, 12, 13))
    })

    it("keeps everything on no, and on a sentence leaves the answer to the planner", () => {
      expect(agentConfirmedRemovalPatch(pending, "no", 12, 13)).toEqual({
        plan: { ...planned.plan, reconciledThrough: 12 }
      })
      expect(
        agentConfirmedRemovalPatch(pending, "yes but keep invoice 1", 12, 13)
      ).toEqual({ plan: planned.plan })
    })

    it("never removes the last outcome", () => {
      const patch = agentConfirmedRemovalPatch(
        {
          ...pending,
          plan: {
            ...pending.plan,
            pending: {
              questionId: "q",
              removals: [{ id: "r1" }, { id: "r2" }]
            }
          }
        },
        "yes",
        12,
        13
      )
      expect(patch.requirements).toBeUndefined()
    })

    it("asks rather than applies what an amendment proposes", () => {
      const patch = agentAmendedPlanPatch(
        planned,
        {
          requirements: planned.requirements ?? [],
          constraints: planned.constraints,
          proposedRemovals: [{ id: "r1" }]
        },
        9,
        10
      )
      expect(patch.requirements).toBeUndefined()
      expect(patch.plan?.pending).toEqual({
        questionId: "run-1:removal:10",
        removals: [{ id: "r1" }]
      })
    })
  })

  /**
   * "Yes" to "no longer needs: do not submit" reads as well as "yes, don't".
   * Lifting a prohibition is asked on its own and answered only by allow.
   */
  describe("lifting a prohibition", () => {
    it("asks a lift question for a forbidding constraint, on its own", () => {
      const patch = agentAmendedPlanPatch(
        planned,
        {
          requirements: planned.requirements ?? [],
          constraints: planned.constraints,
          proposedRemovals: [{ id: "r1" }, { id: "c1" }]
        },
        9,
        10
      )
      expect(patch.plan?.pending).toEqual({
        questionId: "run-1:removal:10",
        removals: [{ id: "c1" }],
        lift: true
      })
    })

    it.each([
      ["yes", 1],
      ["ok", 1],
      ["ja", 1],
      ["sí", 1],
      ["oui", 1],
      ["हाँ", 1],
      ["sì", 1],
      ["はい", 1],
      ["да", 1],
      ["是", 1],
      ["allow", 0]
    ])("on %s keeps %i constraints", (answer, left) => {
      const patch = agentConfirmedRemovalPatch(
        {
          ...planned,
          plan: {
            ...(planned.plan as NonNullable<AgentRunState["plan"]>),
            pending: { questionId: "q", removals: [{ id: "c1" }], lift: true }
          }
        },
        answer,
        12,
        13
      )
      expect((patch.constraints ?? planned.constraints)?.length).toBe(left)
      expect(patch.plan?.pending).toBeUndefined()
    })
  })
})
