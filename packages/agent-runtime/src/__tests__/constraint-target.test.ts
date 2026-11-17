import type {
  AgentRunState,
  AgentTaskConstraint,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  type AgentConstraintObservation,
  agentConfirmedRemovalPatch,
  agentConstraintHold,
  agentForbiddingConstraints,
  agentHeldConstraints,
  agentOptionHoldBroken,
  agentRequirementRecords
} from "../plan-record"

const deleteB: AgentTaskRequirement = {
  id: "r1",
  text: "Invoice B is deleted",
  kind: "change",
  check: { type: "record_state", record: "Invoice B", state: "deleted" }
}
const records = agentRequirementRecords(deleteB)
const destructive = { semanticEffects: ["destructive" as const] }
const inRow = (rowContext: string) => ({
  ...destructive,
  target: { rowContext, accessibleName: "Delete" }
})

/** "Don't delete any other invoice", with the class the planner added. */
const otherInvoices = (
  extra: Partial<AgentTaskConstraint> = {}
): AgentTaskConstraint => ({
  id: "c1",
  text: "Do not delete any invoice other than Invoice B.",
  kind: "exclude",
  forbids: ["destructive"],
  inferred: ["destructive"],
  about: { type: "other_records" },
  source: "Don't delete any other invoice",
  ...extra
})

const refused = (
  effect: Parameters<typeof agentForbiddingConstraints>[0],
  constraints: AgentTaskConstraint[],
  plan: AgentTaskRequirement[] = [deleteB],
  observed?: AgentConstraintObservation,
  requirement: AgentTaskRequirement = deleteB
) =>
  agentForbiddingConstraints(
    effect,
    constraints,
    agentRequirementRecords(requirement),
    requirement,
    plan,
    undefined,
    observed
  )

describe("a constraint's stated target", () => {
  it("binds an old plan's classes exactly as before", () => {
    const old: AgentTaskConstraint = {
      id: "c1",
      text: "Do not delete any invoice other than Invoice B.",
      kind: "exclude",
      forbids: ["destructive"]
    }
    expect(refused(inRow("Invoice B Delete"), [old])).toEqual([
      { constraint: old, effects: ["destructive"], byClass: true }
    ])
    expect(
      agentHeldConstraints([old], {
        target: { rowContext: "Invoice B Delete" },
        records,
        plan: [deleteB]
      })
    ).toEqual([])
  })

  it("lifts the planner's class for the requested record's own row", () => {
    expect(refused(inRow("Invoice B $40 Delete"), [otherInvoices()])).toEqual(
      []
    )
    expect(
      agentHeldConstraints([otherInvoices()], {
        target: { rowContext: "Invoice B $40 Delete" },
        records,
        plan: [deleteB]
      })
    ).toEqual(["c1"])
  })

  it("never lifts a class the user's own words gave, whatever the planner says", () => {
    const userWorded = otherInvoices({ inferred: undefined })
    expect(refused(inRow("Invoice B Delete"), [userWorded])).toEqual([
      { constraint: userWorded, effects: ["destructive"], byClass: true }
    ])
    /** One user class beside a planner class: only the planner's goes. */
    const mixed = otherInvoices({
      forbids: ["destructive", "submission"],
      inferred: ["submission"]
    })
    expect(refused(inRow("Invoice B Delete"), [mixed])).toEqual([
      { constraint: mixed, effects: ["destructive"], byClass: true }
    ])
  })

  it("keeps refusing in a row that names a different record", () => {
    for (const row of [
      "Invoice B-2 Delete",
      "Invoice BB Delete",
      "Invoice A Delete"
    ])
      expect(refused(inRow(row), [otherInvoices()])).toHaveLength(1)
    /** A row naming the record and another planned one proves neither. */
    const payA: AgentTaskRequirement = {
      id: "r2",
      text: "Invoice A is paid",
      kind: "change",
      check: { type: "record_state", record: "Invoice A", state: "saved" }
    }
    expect(
      refused(
        inRow("Invoice B see Invoice A Delete"),
        [otherInvoices()],
        [deleteB, payA]
      )
    ).toHaveLength(1)
  })

  it("lifts nothing for a step bound to a read, or to no requirement", () => {
    const read: AgentTaskRequirement = {
      id: "r2",
      text: "Report Invoice B's total",
      kind: "read",
      check: { type: "row", record: "Invoice B" }
    }
    expect(
      refused(
        inRow("Invoice B Delete"),
        [otherInvoices()],
        [deleteB, read],
        undefined,
        read
      )
    ).toHaveLength(1)
    expect(
      agentForbiddingConstraints(
        inRow("Invoice B Delete"),
        [otherInvoices()],
        records,
        undefined,
        [deleteB]
      )
    ).toHaveLength(1)
  })

  it("keeps refusing when the step's requirement names no record", () => {
    const unnamed: AgentTaskRequirement = {
      id: "r1",
      text: "Clean up the list",
      kind: "change"
    }
    expect(
      refused(
        inRow("Invoice B Delete"),
        [otherInvoices()],
        [unnamed],
        undefined,
        unnamed
      )
    ).toHaveLength(1)
  })

  it("proves a rowless control only on the record's own page", () => {
    const rowless = { ...destructive, target: { accessibleName: "Delete" } }
    const page = (named: string): AgentConstraintObservation => ({
      pageOfRecord: (record) => record === named
    })
    expect(
      refused(rowless, [otherInvoices()], [deleteB], page("Invoice B"))
    ).toEqual([])
    expect(
      refused(rowless, [otherInvoices()], [deleteB], page("Invoice C"))
    ).toHaveLength(1)
    expect(refused(rowless, [otherInvoices()])).toHaveLength(1)
  })

  it("does not let a wrong target lift a class", () => {
    /** An option target on a ban about records: its control is not there. */
    const wrong = otherInvoices({
      about: {
        type: "option",
        hold: { type: "checked", name: "invoice", checked: false }
      }
    })
    const absent: AgentConstraintObservation = { option: () => "absent" }
    const differs: AgentConstraintObservation = { option: () => "differs" }
    expect(
      refused(inRow("Invoice B Delete"), [wrong], [deleteB], absent)
    ).toHaveLength(1)
    expect(
      refused(inRow("Invoice B Delete"), [wrong], [deleteB], differs)
    ).toHaveLength(1)
    /** `effect` and `answer` name no check, so nothing is ever lifted. */
    for (const type of ["effect", "answer"] as const)
      expect(
        refused(inRow("Invoice B Delete"), [otherInvoices({ about: { type } })])
      ).toHaveLength(1)
  })

  it("does not let an option hold prove a 'leave the rest alone' bound", () => {
    const leaveOthers: AgentTaskConstraint = {
      id: "c1",
      text: "Leave the other records alone.",
      kind: "exclude",
      about: {
        type: "option",
        hold: { type: "checked", name: "records", checked: true }
      },
      source: "Leave the other records alone"
    }
    const rowless = { ...destructive, target: { accessibleName: "Delete" } }
    expect(
      refused(rowless, [leaveOthers], [deleteB], { option: () => "holds" })
    ).toHaveLength(1)
  })
})

describe("an option hold", () => {
  const book: AgentTaskRequirement = {
    id: "r1",
    text: "The flight is booked",
    kind: "change",
    source: "Book the flight"
  }
  const insurance: AgentTaskConstraint = {
    id: "c1",
    text: "Do not add travel insurance.",
    kind: "exclude",
    forbids: ["potential_commit"],
    inferred: ["potential_commit"],
    about: {
      type: "option",
      hold: { type: "checked", name: "Travel insurance", checked: false }
    },
    source: "don't add travel insurance"
  }
  const bookFlight = {
    semanticEffects: ["activation" as const],
    target: { committingLabel: true, accessibleName: "Book flight" }
  }
  const observed = (
    state: "holds" | "differs" | "absent"
  ): AgentConstraintObservation => ({ option: () => state })

  it("lets the commit go only while the option holds its state", () => {
    expect(
      refused(bookFlight, [insurance], [book], observed("holds"), book)
    ).toEqual([])
    for (const state of ["differs", "absent"] as const)
      expect(
        refused(bookFlight, [insurance], [book], observed(state), book)
      ).toHaveLength(1)
  })

  it("refuses a commit while the option is in the wrong state, and only then", () => {
    expect(
      agentOptionHoldBroken(bookFlight, [insurance], observed("differs"))
    ).toMatchObject({ constraint: { id: "c1" } })
    expect(
      agentOptionHoldBroken(bookFlight, [insurance], observed("absent"))
    ).toBeUndefined()
    expect(
      agentOptionHoldBroken(
        { semanticEffects: ["activation"] },
        [insurance],
        observed("differs")
      )
    ).toBeUndefined()
  })

  it("does not infer a hold when another same-source change has no hold check", () => {
    const source = "Change Name and Email without changing anything else"
    expect(
      agentConstraintHold(
        { id: "c1", text: "Nothing else", kind: "exclude", source },
        [
          {
            id: "r1",
            kind: "change",
            text: "Name",
            source,
            check: { type: "field", name: "Name", value: "Ada" }
          },
          { id: "r2", kind: "change", text: "Email", source }
        ]
      )
    ).toBeUndefined()
  })

  it("falls back to a sibling check planned from the very same words", () => {
    const { about: _about, ...untargeted } = insurance
    const unticked: AgentTaskRequirement = {
      id: "r2",
      text: "Travel insurance is not added",
      kind: "change",
      source: "don't add travel insurance",
      check: { type: "checked", name: "Travel insurance", checked: false }
    }
    let asked: unknown
    const holds: AgentConstraintObservation = {
      option: (hold) => {
        asked = hold
        return "holds"
      }
    }
    expect(
      refused(bookFlight, [untargeted], [book, unticked], holds, book)
    ).toEqual([])
    expect(asked).toEqual({
      type: "checked",
      name: "Travel insurance",
      checked: false
    })
    /** A sibling quoting other words is not the same instruction. */
    expect(
      refused(
        bookFlight,
        [untargeted],
        [book, { ...unticked, source: "skip the insurance" }],
        holds,
        book
      )
    ).toHaveLength(1)
  })
})

describe("the answer to a conflict question", () => {
  const conflicted = (constraint: AgentTaskConstraint) =>
    ({
      requirements: [deleteB],
      constraints: [constraint],
      plan: {
        version: 1,
        issued: { requirements: 1, constraints: 1 },
        pending: {
          questionId: "run-1:conflict:c1:r1",
          removals: [{ id: "c1" }],
          lift: true as const,
          conflict: { requirementId: "r1", effects: ["destructive" as const] }
        }
      }
    }) satisfies Pick<AgentRunState, "plan" | "requirements" | "constraints">

  it("narrows a user-worded class to other records, recorded as an amendment", () => {
    const patch = agentConfirmedRemovalPatch(
      conflicted(otherInvoices({ inferred: undefined, about: undefined })),
      "allow",
      20,
      21
    )
    expect(patch.constraints).toEqual([
      expect.objectContaining({
        id: "c1",
        forbids: ["destructive"],
        about: { type: "other_records" },
        narrowedFor: ["r1"]
      })
    ])
    expect(patch.plan?.pending).toBeUndefined()
    expect(patch.plan?.amendments?.at(-1)).toMatchObject({
      version: 2,
      narrowed: ["c1"]
    })
    /** Narrowed, the requested record's own row goes; another record's not. */
    const narrowed = patch.constraints ?? []
    expect(refused(inRow("Invoice B Delete"), narrowed)).toEqual([])
    expect(refused(inRow("Invoice B-2 Delete"), narrowed)).toHaveLength(1)
    /**
     * The user allowed r1's act only: a delete bound to another planned
     * outcome, in that outcome's own row, is still refused.
     */
    const payC: AgentTaskRequirement = {
      id: "r2",
      text: "Invoice C is paid",
      kind: "change",
      check: { type: "record_state", record: "Invoice C", state: "saved" }
    }
    expect(
      refused(
        inRow("Invoice C Delete"),
        narrowed,
        [deleteB, payC],
        undefined,
        payC
      )
    ).toHaveLength(1)
  })

  it("drops only the planner's conflicting class on allow", () => {
    const patch = agentConfirmedRemovalPatch(
      conflicted(
        otherInvoices({
          forbids: ["destructive", "payment"],
          inferred: ["destructive"],
          about: undefined
        })
      ),
      "allow",
      20,
      21
    )
    expect(patch.constraints?.[0]?.forbids).toEqual(["payment"])
    expect(patch.constraints?.[0]?.inferred).toBeUndefined()
  })

  it("keeps the constraint for any answer but allow", () => {
    for (const answer of ["yes", "ok", "please delete it"]) {
      const state = conflicted(otherInvoices({ inferred: undefined }))
      const patch = agentConfirmedRemovalPatch(state, answer, 20, 21)
      expect(patch.constraints).toBeUndefined()
      expect(patch.plan?.pending).toBeUndefined()
      expect(patch.plan?.version).toBe(1)
    }
  })
})
