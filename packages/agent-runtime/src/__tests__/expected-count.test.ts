import type { AgentTaskRequirement } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  agentCountPermitsRepeat,
  agentExceedsExpectedCount,
  agentExpectedCountRefusal,
  agentRequirementCount
} from "../expected-count"
import type { AgentStepReadout, ResolvedAgentEffect } from "../ports"

let sequence = 0
const receipt = (patch: Partial<AgentStepReadout>): AgentStepReadout => {
  sequence += 1
  return {
    runId: "run-1",
    stepId: `run-1:${sequence}`,
    status: "verified",
    at: sequence,
    sequence,
    requirementId: "r1",
    mutating: true,
    consequential: ["submission"],
    command: {
      type: "click",
      ref: "e1",
      snapshotId: "s",
      generation: 1
    } as AgentStepReadout["command"],
    target: { role: "button", name: "Place order" },
    ...patch
  }
}

const press = (patch: Partial<ResolvedAgentEffect> = {}): ResolvedAgentEffect =>
  ({
    command: { type: "click", ref: "e9", snapshotId: "s", generation: 2 },
    target: { ref: "e9", role: "button", accessibleName: "Place order" },
    semanticEffects: ["activation", "submission"],
    ...patch
  }) as ResolvedAgentEffect

const button = (name: string, rowContext?: string) =>
  press({
    target: {
      ref: "e4",
      role: "button",
      accessibleName: name,
      ...(rowContext ? { rowContext } : {})
    } as ResolvedAgentEffect["target"]
  })

const placeOnce: AgentTaskRequirement = {
  id: "r1",
  text: "One order is placed",
  kind: "change",
  times: 1
}

const dialogAccept = {
  type: "handle_dialog",
  dialogId: "d1",
  accept: true,
  snapshotId: "s",
  generation: 2
}

describe("a requirement's stated count", () => {
  it("changes nothing for a requirement that states no count", () => {
    const { times: _times, ...uncounted } = placeOnce
    expect(
      agentExceedsExpectedCount(press(), uncounted, [receipt({})])
    ).toBeUndefined()
  })

  it("refuses the act that would go past it, naming the counted step", () => {
    expect(agentExceedsExpectedCount(press(), placeOnce, [])).toBeUndefined()
    const first = receipt({})
    const exceeded = agentExceedsExpectedCount(press(), placeOnce, [first])
    expect(exceeded).toMatchObject({ times: 1, applied: 1 })
    expect(agentExpectedCountRefusal("r1", exceeded!)).toContain(first.stepId)
    /** Rebuilt from receipts alone, so a worker restart counts the same. */
    expect(agentRequirementCount(placeOnce, [first]).applied).toBe(1)
  })

  it("counts an act that may have landed, and not one that never did", () => {
    for (const status of [
      "approved",
      "executing",
      "executed",
      "uncertain"
    ] as const)
      expect(
        agentExceedsExpectedCount(press(), placeOnce, [receipt({ status })])
      ).toBeDefined()
    for (const status of ["planned", "rejected", "failed"] as const)
      expect(
        agentExceedsExpectedCount(press(), placeOnce, [receipt({ status })])
      ).toBeUndefined()
  })

  it("counts the same control, not every step of the requirement", () => {
    /** A checkout's shipping form is a step toward the one order, not an order. */
    const shipping = receipt({
      target: { role: "button", name: "Continue to payment" }
    })
    expect(
      agentExceedsExpectedCount(press(), placeOnce, [shipping])
    ).toBeUndefined()
    const placed = receipt({})
    expect(agentRequirementCount(placeOnce, [shipping, placed]).applied).toBe(1)
    expect(
      agentExceedsExpectedCount(press(), placeOnce, [shipping, placed])
    ).toMatchObject({ applied: 1, lastStepId: placed.stepId })
  })

  it("lets a page's own Confirm finish the act its opener started, once", () => {
    const remove: AgentTaskRequirement = { ...placeOnce, text: "Delete it" }
    const opener = receipt({
      consequential: ["destructive"],
      target: { role: "button", name: "Delete" }
    })
    const confirm = button("Confirm")
    expect(agentExceedsExpectedCount(confirm, remove, [opener])).toBeUndefined()
    const confirmed = receipt({
      consequential: ["destructive"],
      target: { role: "button", name: "Confirm" }
    })
    expect(agentRequirementCount(remove, [opener, confirmed]).applied).toBe(1)
    /** A second opener is a second delete. */
    expect(
      agentExceedsExpectedCount(button("Delete"), remove, [opener, confirmed])
    ).toBeDefined()
  })

  it("lets the dialog confirming the counted act through, once", () => {
    const remove: AgentTaskRequirement = { ...placeOnce, text: "Delete it" }
    const accept = press({
      command: dialogAccept as unknown as ResolvedAgentEffect["command"],
      target: {} as ResolvedAgentEffect["target"],
      semanticEffects: ["destructive"]
    })
    const opener = receipt({ consequential: ["destructive"] })
    expect(agentExceedsExpectedCount(accept, remove, [opener])).toBeUndefined()
    const accepted = receipt({
      consequential: ["destructive"],
      command: dialogAccept as unknown as AgentStepReadout["command"],
      target: undefined
    })
    expect(agentRequirementCount(remove, [opener, accepted]).applied).toBe(1)
    /** A second accept after the pair is a second act. */
    expect(
      agentExceedsExpectedCount(accept, remove, [opener, accepted])
    ).toBeDefined()
  })

  it("allows a stated second identical act and refuses the third", () => {
    const placeTwice = { ...placeOnce, times: 2 }
    const first = receipt({})
    expect(
      agentExceedsExpectedCount(press(), placeTwice, [first])
    ).toBeUndefined()
    expect(agentCountPermitsRepeat(press(), placeTwice, [first])).toBe(true)
    const second = receipt({})
    expect(
      agentExceedsExpectedCount(press(), placeTwice, [first, second])
    ).toMatchObject({ times: 2, applied: 2 })
    expect(agentCountPermitsRepeat(press(), placeTwice, [first, second])).toBe(
      false
    )
  })

  it("never lets a count waive a repeat of an act bound elsewhere", () => {
    const placeTwice = { ...placeOnce, times: 2 }
    expect(
      agentCountPermitsRepeat(press(), placeTwice, [
        receipt({ requirementId: "r2" })
      ])
    ).toBe(false)
    /** A count of one never waives anything. */
    expect(agentCountPermitsRepeat(press(), placeOnce, [])).toBe(false)
  })

  it("does not count acts bound to another requirement, a cart, or a read", () => {
    const steps = [
      receipt({ requirementId: "r2" }),
      receipt({ cartAddition: true, consequential: ["potential_commit"] }),
      receipt({ consequential: [], mutating: false })
    ]
    expect(agentRequirementCount(placeOnce, steps).applied).toBe(0)
    expect(agentExceedsExpectedCount(press(), placeOnce, steps)).toBeUndefined()
    /** Adding to a cart is never refused by the count either. */
    expect(
      agentExceedsExpectedCount(
        press({
          target: {
            ref: "e3",
            accessibleName: "Add to cart",
            cartLabel: true
          } as ResolvedAgentEffect["target"]
        }),
        placeOnce,
        [receipt({})]
      )
    ).toBeUndefined()
  })

  describe("with items", () => {
    const payEach: AgentTaskRequirement = {
      id: "r1",
      text: "Each invoice is paid once",
      kind: "change",
      times: 1,
      items: ["Invoice A", "Invoice B"]
    }
    const paid = (row: string) =>
      receipt({ target: { role: "button", name: "Pay", rowContext: row } })

    it("counts each item on its own", () => {
      const paidA = paid("Invoice A Pay")
      expect(
        agentExceedsExpectedCount(button("Pay", "Invoice A Pay"), payEach, [
          paidA
        ])
      ).toMatchObject({ item: "Invoice A" })
      expect(
        agentExceedsExpectedCount(button("Pay", "Invoice B Pay"), payEach, [
          paidA
        ])
      ).toBeUndefined()
    })

    it("refuses a second act on one item and counts two as a contradiction", () => {
      const twiceOnA = [paid("Invoice A Pay"), paid("Invoice A Pay")]
      /** Two acts in all is the whole budget, but both were on A. */
      expect(agentRequirementCount(payEach, twiceOnA)).toMatchObject({
        applied: 2,
        perItem: [2, 0]
      })
    })

    it("holds a same-control act naming no item against the named item", () => {
      const unnamed = receipt({ target: { role: "button", name: "Pay" } })
      expect(
        agentExceedsExpectedCount(button("Pay", "Invoice B Pay"), payEach, [
          unnamed
        ])
      ).toMatchObject({ item: "Invoice B", applied: 1 })
    })

    it("answers a rowless act by the record page it is on", () => {
      const onB = receipt({ target: { role: "button", name: "Pay" } })
      const onPageOfB = (item: string) => item === "Invoice B"
      expect(
        agentExceedsExpectedCount(
          button("Pay"),
          payEach,
          [onB],
          undefined,
          onPageOfB
        )
      ).toMatchObject({ item: "Invoice B" })
      /** Without a page of record it falls to the whole budget. */
      expect(
        agentExceedsExpectedCount(button("Pay"), payEach, [onB])
      ).toBeUndefined()
    })
  })
})
