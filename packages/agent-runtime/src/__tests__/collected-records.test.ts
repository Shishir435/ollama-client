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
    ["QF-RESEARCH-734-1 Tool Kit 40 credits", undefined, 40],
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

  it("computes over a measure the quotes share by unit word alone", () => {
    const quoted = (item: string, value: number): AgentCollectedRecord => ({
      ...record(item, value),
      quote: `QF-RESEARCH-734-1 ${item} ${value} credits`
    })
    const rows = [quoted("Shop A", 41), quoted("Shop B", 35)]
    const source = read("r1", "Read each shop's entry", ["Shop A", "Shop B"])
    const cheapest = read("r2", "Which shop is cheapest")
    expect(agentComparedAnswer(cheapest, rows, [source, cheapest])).toBe(
      rows[1]
    )
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

  it.each([
    ["Welcher Shop ist am günstigsten?", 1],
    ["¿Qué tienda es la más barata?", 1],
    ["Quelle boutique est la moins chère ?", 1],
    ["Quale negozio è il più economico?", 1],
    ["Какой магазин самый дешёвый?", 1],
    ["कौन सी दुकान सबसे सस्ती है?", 1],
    ["どの店が一番安いですか", 1],
    ["哪家店最便宜", 1],
    ["Welcher Shop ist am teuersten?", 0],
    ["¿Qué tienda es la más cara?", 0],
    ["Quelle boutique est la plus chère ?", 0],
    ["Какой магазин самый дорогой?", 0],
    ["कौन सी दुकान सबसे महंगी है?", 0],
    ["哪家店最贵", 0],
    ["¿Qué tienda tiene el precio más bajo?", 1],
    ["Welcher Shop hat den niedrigsten Preis?", 1],
    ["価格が最も高い店はどれですか", 0]
  ] as const)("computes %s in its own language", (text, winner) => {
    const prices = read("r1", "Read each shop's price", ["Shop A", "Shop B"])
    const asked = read("r2", text)
    expect(agentComparedAnswer(asked, collected, [prices, asked])).toBe(
      collected[winner]
    )
  })

  it("reads a price measure written in another language", () => {
    const prices = read("r1", "Lies den Preis jedes Shops", [
      "Shop A",
      "Shop B"
    ])
    const asked = read("r2", "Which shop is cheapest")
    expect(agentComparedAnswer(asked, collected, [prices, asked])).toBe(
      collected[1]
    )
  })

  it.each([
    "¿Qué tienda tiene la valoración más alta?",
    "Welcher Shop hat die höchste Bewertung?",
    "评分最高的是哪家店",
    "哪家店的评价最高",
    "円の数が最多の作品",
    "Welcher Shop ist am günstigsten und hat die höchste Bewertung?",
    "Какой центр самый большой?"
  ])("leaves %s to review", (text) => {
    const prices = read("r1", "Read each shop's price", ["Shop A", "Shop B"])
    const asked = read("r2", text)
    expect(
      agentComparedAnswer(asked, collected, [prices, asked])
    ).toBeUndefined()
  })

  it.each([
    ["Shop B ist am günstigsten mit 35 Credits. Shop A kostet 41.", "agrees"],
    ["Shop B a 35, et Shop A a 41", "agrees"],
    ["Shop B 35、Shop A 41。", "agrees"],
    ["Shop B costa 41 crediti", "disagrees"]
  ] as const)("judges %s in another language", (answer, stance) => {
    expect(agentAnswerAgainstCompared(answer, collected[1], collected)).toBe(
      stance
    )
  })
})
