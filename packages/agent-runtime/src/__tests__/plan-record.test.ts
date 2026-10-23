import type { AgentRunState } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  agentAmendedPlanPatch,
  agentConfirmedRemovalPatch,
  agentForbiddingConstraints,
  agentInitialPlanPatch,
  agentPlanNeedsReconciling,
  agentRequirementRecords,
  agentRowOutsideScope,
  agentWrongRowRecord
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
  it("keeps added work outstanding after confirming a removal that frees capacity", () => {
    const patch = agentAmendedPlanPatch(
      planned,
      {
        requirements: planned.requirements ?? [],
        constraints: planned.constraints,
        proposedRemovals: [{ id: "r1" }],
        provisional: true
      },
      9,
      10
    )
    expect(patch.plan?.pending?.provisional).toBe(true)
    const confirmed = agentConfirmedRemovalPatch(
      { ...planned, ...patch },
      "yes",
      12,
      12
    )
    expect(confirmed.requirements?.map(({ id }) => id)).toEqual(["r2"])
    expect(confirmed.plan).toMatchObject({ reconciledThrough: 5 })
    expect(confirmed.plan?.pending).toBeUndefined()
    expect(
      agentPlanNeedsReconciling({ ...planned, ...confirmed }, [
        { questionId: "q", text: "Also the new outcome", answeredAt: 9 }
      ])
    ).toBe(9)
  })

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

  it("lets a purchase fill its cart under a limit that forbids paying", () => {
    const cart = {
      semanticEffects: ["activation" as const],
      target: { committingLabel: true, cartLabel: true }
    }
    const limits = [
      {
        id: "c1",
        text: "Do not pay or place the order.",
        kind: "exclude" as const,
        forbids: ["payment" as const]
      },
      {
        id: "c2",
        text: "Proceed only to the payment step.",
        kind: "scope" as const
      }
    ]
    const buy = {
      id: "r2",
      kind: "change" as const,
      text: "Purchase the Blue Kettle up to the payment step."
    }
    expect(agentForbiddingConstraints(cart, limits, [], buy)).toEqual([])
    /** A step naming no requirement is read against the plan's purchase. */
    expect(
      agentForbiddingConstraints(cart, limits, [], undefined, [
        { id: "r1", kind: "read", text: "Report the kettle's price." },
        buy
      ])
    ).toEqual([])
    expect(
      agentForbiddingConstraints(cart, limits, [], undefined, [
        { id: "r1", kind: "read", text: "Report the kettle's price." }
      ])
    ).not.toEqual([])
    /** No purchase asked for: "don't pay" still stops a cart. */
    expect(
      agentForbiddingConstraints(cart, limits, [], {
        id: "r1",
        kind: "read",
        text: "Report the kettle's price."
      })
    ).not.toEqual([])
    for (const text of [
      "Order Blue Kettle up to the payment step.",
      "Fill the cart with Blue Kettle."
    ])
      expect(
        agentForbiddingConstraints(cart, limits, [], {
          id: "r4",
          kind: "change",
          text
        })
      ).toEqual([])
    /** Removing from a cart or editing an order note is not buying. */
    expect(
      agentForbiddingConstraints(cart, limits, [], {
        id: "r3",
        kind: "change",
        text: "Remove the mug from the cart."
      })
    ).not.toEqual([])
    /** Any other committing control keeps every limit. */
    expect(
      agentForbiddingConstraints(
        { ...cart, target: { committingLabel: true } },
        limits,
        [],
        buy
      )
    ).not.toEqual([])
  })

  it("lets a save through a no-submit constraint and an unproven scope", () => {
    const save = {
      semanticEffects: ["activation" as const],
      target: { savingLabel: true }
    }
    expect(agentForbiddingConstraints(save, planned.constraints)).toEqual([])
    expect(
      agentForbiddingConstraints(save, [
        { id: "c2", text: "Only Record 6", kind: "scope" }
      ])
    ).toEqual([])
  })

  it("proves a scope limit only by the row naming the step's one record", () => {
    const remove = (rowContext?: string) => ({
      semanticEffects: ["destructive" as const],
      target: rowContext ? { rowContext } : {}
    })
    const scope = [
      { id: "c1", text: "Keep every other invoice", kind: "scope" as const }
    ]
    const records = agentRequirementRecords({
      id: "r1",
      text: "Invoice B is deleted",
      kind: "change",
      check: { type: "record_state", record: "Invoice B", state: "deleted" }
    })
    expect(records).toEqual(["Invoice B"])
    expect(
      agentForbiddingConstraints(remove("Invoice B $40 Delete"), scope, records)
    ).toEqual([])
    expect(
      agentForbiddingConstraints(
        remove("Invoice B2 $40 Delete"),
        scope,
        records
      )
    ).toHaveLength(1)
    expect(
      agentForbiddingConstraints(remove("Invoice A $12 Delete"), scope, records)
    ).toHaveLength(1)
    /** An id's joiner keeps it whole: Invoice B-2 is not Invoice B. */
    for (const row of ["Invoice B-2 Delete", "Invoice B.2 Delete"])
      expect(
        agentForbiddingConstraints(remove(row), scope, records)
      ).toHaveLength(1)
    expect(
      agentForbiddingConstraints(remove("Invoice B. Delete"), scope, records)
    ).toEqual([])
    expect(agentForbiddingConstraints(remove(), scope, records)).toHaveLength(1)
    expect(
      agentForbiddingConstraints(remove("Invoice B $40 Delete"), scope)
    ).toHaveLength(1)
  })

  it("binds an exclusion naming no effect to the step's own record", () => {
    const remove = (rowContext: string) => ({
      semanticEffects: ["destructive" as const],
      target: { rowContext }
    })
    const keep = [
      { id: "c1", text: "Keep every other invoice", kind: "exclude" as const }
    ]
    const records = ["Invoice B"]
    expect(
      agentForbiddingConstraints(remove("Invoice B Delete"), keep, records)
    ).toEqual([])
    expect(
      agentForbiddingConstraints(remove("Invoice B-2 Delete"), keep, records)
    ).toHaveLength(1)
    /** A step about no record, and an exclusion naming its class, as before. */
    expect(
      agentForbiddingConstraints(remove("Invoice B-2 Delete"), keep)
    ).toEqual([])
    expect(
      agentForbiddingConstraints(
        remove("Invoice B Delete"),
        [{ ...keep[0], forbids: ["submission" as const] }],
        records
      )
    ).toEqual([])
  })

  it("names another planned record's row, and nothing else, as the wrong row", () => {
    const requirements = [
      {
        id: "r1",
        text: "Invoice A is paid",
        kind: "change" as const,
        check: {
          type: "control_transition" as const,
          from: "Mark paid",
          to: "Paid",
          record: "Invoice A"
        }
      },
      {
        id: "r2",
        text: "Invoice B is paid",
        kind: "change" as const,
        check: {
          type: "control_transition" as const,
          from: "Mark paid",
          to: "Paid",
          record: "Invoice B"
        }
      }
    ]
    const [first, second] = requirements
    expect(
      agentWrongRowRecord(
        { rowContext: "Invoice A $12 Mark paid" },
        second,
        requirements
      )
    ).toBe("Invoice A")
    expect(
      agentWrongRowRecord(
        { rowContext: "Invoice B $40 Mark paid" },
        second,
        requirements
      )
    ).toBeUndefined()
    expect(
      agentWrongRowRecord(
        { rowContext: "INV-002 Mark paid" },
        first,
        requirements
      )
    ).toBeUndefined()
    expect(agentWrongRowRecord({}, first, requirements)).toBeUndefined()
  })

  it("refuses a row naming none of the step's records while others must stay", () => {
    const requirement = {
      id: "r1",
      text: "Mark the named records as Paid once each.",
      kind: "change" as const,
      items: ["Record 2", "Record 5"]
    }
    const leaveOthers = [
      {
        id: "c1",
        text: "Do not change any other record.",
        kind: "exclude" as const
      }
    ]
    expect(
      agentRowOutsideScope(
        { rowContext: "Record 4 Due Mark Paid" },
        requirement,
        leaveOthers
      )
    ).toMatchObject({ id: "c1" })
    expect(
      agentRowOutsideScope(
        { rowContext: "Record 5 Due Mark Paid" },
        requirement,
        leaveOthers
      )
    ).toBeUndefined()
    /** "Record 2" is not named by "Record 20". */
    expect(
      agentRowOutsideScope(
        { rowContext: "Record 20 Due Mark Paid" },
        requirement,
        leaveOthers
      )
    ).toMatchObject({ id: "c1" })
    /** No row, no constraint about the rest, or no records: nothing to bind. */
    expect(agentRowOutsideScope({}, requirement, leaveOthers)).toBeUndefined()
    expect(
      agentRowOutsideScope({ rowContext: "Record 4 Due" }, requirement, [
        { id: "c1", text: "Do not pay", kind: "exclude", forbids: ["payment"] }
      ])
    ).toBeUndefined()
    expect(
      agentRowOutsideScope(
        { rowContext: "Record 4 Due" },
        { id: "r1", text: "Mark paid", kind: "change" },
        leaveOthers
      )
    ).toBeUndefined()
  })

  it("refuses a committing-labelled script button under a no-submit constraint", () => {
    expect(
      agentForbiddingConstraints(
        {
          semanticEffects: ["activation"],
          target: { committingLabel: true }
        },
        planned.constraints
      )
    ).toEqual([
      { constraint: planned.constraints?.[0], effects: ["potential_commit"] }
    ])
  })

  it("refuses consequential scope and payment bounds without authoritative bindings", () => {
    const scope = { id: "c1", text: "Only Record 42", kind: "scope" as const }
    const limit = {
      id: "c2",
      text: "Spend at most 10 credits",
      kind: "limit" as const
    }
    expect(
      agentForbiddingConstraints({ semanticEffects: ["destructive"] }, [scope])
    ).toEqual([{ constraint: scope, effects: ["destructive"] }])
    expect(
      agentForbiddingConstraints({ semanticEffects: ["payment"] }, [limit])
    ).toEqual([{ constraint: limit, effects: ["payment"] }])
    expect(
      agentForbiddingConstraints({ semanticEffects: ["read", "navigation"] }, [
        scope,
        limit
      ])
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

    it.each(["sí", "sì", "हाँ", "नहीं"])(
      "preserves combining marks in %s",
      (answer) => {
        expect(
          agentConfirmedRemovalPatch(pending, answer.normalize("NFD"), 12, 13)
        ).toEqual(agentConfirmedRemovalPatch(pending, answer, 12, 13))
      }
    )

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
