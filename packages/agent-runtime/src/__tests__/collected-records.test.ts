import { describe, expect, it } from "vitest"
import {
  agentAnswerAgainstCompared,
  agentQuotedValue,
  type AgentCollectedRecord
} from "../collected-records"

describe("collected records", () => {
  it.each([
    ["Blue Kettle 37 credits", undefined, 37],
    ["Invoice 2 total $1,240.50", "Invoice 2", 1240.5],
    ["Plan 3 costs 19 a month", "Plan 3", 19],
    ["Was 40, now 35", undefined, undefined],
    ["Out of stock", undefined, undefined]
  ])("reads the one number in %s", (quote, item, value) => {
    expect(agentQuotedValue(quote, item)).toBe(value)
  })

  const record = (item: string, value: number): AgentCollectedRecord => ({
    requirementId: "r1",
    itemIndex: 0,
    item,
    quote: `${item} ${value}`,
    value,
    ledgerId: item,
    observedAt: 1
  })
  const collected = [record("Shop A", 41), record("Shop B", 35)]

  it.each([
    ["Shop B, at 35 credits", "agrees"],
    ["Shop B", "agrees"],
    ["Shop B at 41 credits", "disagrees"],
    ["Shop A is cheapest", "disagrees"],
    ["The cheapest is 35", "unrelated"]
  ] as const)("judges %s against the computed answer", (answer, stance) => {
    expect(agentAnswerAgainstCompared(answer, collected[1], collected)).toBe(
      stance
    )
  })
})
