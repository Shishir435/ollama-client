import type { AgentTaskRequirement } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  agentAnswerAgainstCompared,
  agentComparedAnswer,
  agentQuotedValue,
  type AgentCollectedRecord
} from "../collected-records"

describe("collected records", () => {
  it.each([
    ["Blue Kettle 37 credits", undefined, 37],
    ["Invoice 2 total $1,240.50", "Invoice 2", 1240.5],
    ["Plan 3 costs 19 a month", "Plan 3", 19],
    ["Was 40, now 35", undefined, undefined],
    ["Out of stock", undefined, undefined],
    ["Oslo -10 °C", "Oslo", -10],
    ["Lima (\u22124) today", "Lima", -4],
    ["ORD-1042 ships in 3 days", undefined, 3],
    ["Plan 30 costs 19", "Plan 3", undefined],
    ["Plan 3 costs 19, Plan 30 costs 25", "Plan 3", undefined]
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
    ["Shop B is cheapest at 35. Shop A charges 41.", "agrees"],
    ["Shop B at 35, Shop A at 41", "agrees"],
    ["Shop B", "named"],
    ["Shop B at 41 credits", "disagrees"],
    ["Shop A is cheapest", "disagrees"],
    ["Shop B costs 99 credits for 2 units", "unrelated"],
    ["The cheapest is 35", "unrelated"]
  ] as const)("judges %s against the computed answer", (answer, stance) => {
    expect(agentAnswerAgainstCompared(answer, collected[1], collected)).toBe(
      stance
    )
  })

  const read = (
    id: string,
    text: string,
    items?: string[]
  ): AgentTaskRequirement => ({
    id,
    kind: "read",
    text,
    ...(items ? { items } : {})
  })

  it("computes only over the measure the read collected", () => {
    const prices = read("r1", "Read each shop's price", ["Shop A", "Shop B"])
    const cheapest = read("r2", "Which shop is cheapest")
    const rated = read("r2", "Which shop has the highest rating")
    expect(agentComparedAnswer(cheapest, collected, [prices, cheapest])).toBe(
      collected[1]
    )
    expect(
      agentComparedAnswer(rated, collected, [prices, rated])
    ).toBeUndefined()
    const ratings = read("r1", "Read each shop's rating", ["Shop A", "Shop B"])
    expect(agentComparedAnswer(rated, collected, [ratings, rated])).toBe(
      collected[0]
    )
    expect(
      agentComparedAnswer(read("r2", "Which is best"), collected, [prices])
    ).toBeUndefined()
    for (const text of [
      "Which shop is the highest rated",
      "Which shop has the highest feedback"
    ]) {
      const asked = read("r2", text)
      expect(
        agentComparedAnswer(asked, collected, [prices, asked]),
        text
      ).toBeUndefined()
    }
  })

  it("keeps a decimal price whole when splitting sentences", () => {
    const decimals = [record("Shop A", 41.25), record("Shop B", 35.5)]
    expect(
      agentAnswerAgainstCompared(
        "Shop B is cheapest at 35.50. Shop A charges 41.25.",
        decimals[1],
        decimals
      )
    ).toBe("agrees")
  })

  it("compares signed values as signed", () => {
    const cities = [record("Oslo", -10), record("Lima", 2)]
    const temperatures = read("r1", "Read each city's temperature", [
      "Oslo",
      "Lima"
    ])
    const warmest = read("r2", "Which city has the highest temperature")
    expect(agentComparedAnswer(warmest, cities, [temperatures, warmest])).toBe(
      cities[1]
    )
  })
})
