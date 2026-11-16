import type { AgentTaskRequirement } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
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

const placeOnce: AgentTaskRequirement = {
  id: "r1",
  text: "One order is placed",
  kind: "change",
  times: 1
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

  it("counts Enter after the button as a second act, whatever the control", () => {
    const enter = press({
      command: {
        type: "press_key",
        key: "Enter",
        snapshotId: "s",
        generation: 3
      } as ResolvedAgentEffect["command"],
      target: { ref: "e2", role: "textbox", accessibleName: "Notes" }
    } as Partial<ResolvedAgentEffect>)
    expect(
      agentExceedsExpectedCount(enter, placeOnce, [receipt({})])
    ).toBeDefined()
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

  it("lets the dialog confirming the counted act through, once", () => {
    const remove: AgentTaskRequirement = { ...placeOnce, text: "Delete it" }
    const accept = press({
      command: {
        type: "handle_dialog",
        dialogId: "d1",
        accept: true,
        snapshotId: "s",
        generation: 2
      } as unknown as ResolvedAgentEffect["command"],
      semanticEffects: ["destructive"]
    })
    const opener = receipt({ consequential: ["destructive"] })
    expect(agentExceedsExpectedCount(accept, remove, [opener])).toBeUndefined()
    const accepted = receipt({
      consequential: ["destructive"],
      command: {
        type: "handle_dialog",
        dialogId: "d1",
        accept: true
      } as unknown as AgentStepReadout["command"]
    })
    expect(agentRequirementCount(remove, [opener, accepted]).applied).toBe(1)
    /** A second accept after the pair is a second act. */
    expect(
      agentExceedsExpectedCount(accept, remove, [opener, accepted])
    ).toBeDefined()
  })

  it("counts per item, and a receipt naming no item against the whole", () => {
    const payEach: AgentTaskRequirement = {
      id: "r1",
      text: "Each invoice is paid once",
      kind: "change",
      times: 1,
      items: ["Invoice A", "Invoice B"]
    }
    const inRow = (row: string) =>
      press({
        target: {
          ref: "e4",
          accessibleName: "Pay",
          rowContext: row
        } as ResolvedAgentEffect["target"]
      })
    const paidA = receipt({
      target: { name: "Pay", rowContext: "Invoice A Pay" }
    })
    expect(
      agentExceedsExpectedCount(inRow("Invoice A Pay"), payEach, [paidA])
    ).toMatchObject({ item: "Invoice A" })
    expect(
      agentExceedsExpectedCount(inRow("Invoice B Pay"), payEach, [paidA])
    ).toBeUndefined()
    const unnamed = receipt({ target: { name: "Pay" } })
    expect(
      agentExceedsExpectedCount(inRow("Invoice B Pay"), payEach, [
        paidA,
        unnamed
      ])
    ).toMatchObject({ applied: 2 })
  })
})
