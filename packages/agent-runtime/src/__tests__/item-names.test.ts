import type { AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { agentReceiptNamesItem } from "../completion"
import type { AgentStepReadout } from "../ports"

/**
 * An item is a record, and a record's id keeps its joiners: "Invoice B-2" is
 * not "Invoice B" with a suffix. Measured live, a run told to delete Invoice B
 * and keep the rest deleted B-2 as well, because its row read as B's. The
 * row matcher got the rule; the matcher that credits a receipt to an item did
 * not, so the same row was refused in one place and counted in the other.
 */
describe("agentReceiptNamesItem", () => {
  const items = ["Invoice B", "Invoice C"]
  const observation = {} as AgentObservation
  const acted = (rowContext: string): AgentStepReadout =>
    ({
      stepId: "run-1:1",
      sequence: 1,
      status: "verified",
      target: { ref: "e1", tag: "button", name: "Mark paid", rowContext }
    }) as AgentStepReadout

  it("credits the item whose row the receipt acted in", () => {
    expect(
      agentReceiptNamesItem(
        acted("Invoice B · $40"),
        "Invoice B",
        items,
        observation
      )
    ).toBe(true)
  })

  it.each([
    "Invoice B-2 · $40",
    "Invoice B.2 · $40",
    "Invoice B/2 · $40",
    "Invoice B2 · $40"
  ])("does not credit it for a different record's row (%s)", (row) => {
    expect(
      agentReceiptNamesItem(acted(row), "Invoice B", items, observation)
    ).toBe(false)
  })

  it("keeps a combining mark with its letter", () => {
    /** "Café" written as e plus U+0301, and the item "Caf" would be a prefix of it. */
    expect(
      agentReceiptNamesItem(
        acted("Cafe\u0301 · $4"),
        "Cafe",
        ["Cafe", "Bar"],
        observation
      )
    ).toBe(false)
    expect(
      agentReceiptNamesItem(
        acted("Cafe\u0301 · $4"),
        "Cafe\u0301",
        ["Cafe\u0301", "Bar"],
        observation
      )
    ).toBe(true)
  })
})
