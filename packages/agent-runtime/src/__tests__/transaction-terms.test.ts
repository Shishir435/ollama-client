import type {
  AgentTaskConstraint,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { agentForbiddingConstraints } from "../plan-record"
import {
  agentConstraintPriceLimit,
  agentPriceLimit,
  agentPriceLimitHolds
} from "../transaction-terms"

const words = "Don't book anything over 120 credits a night."
const cap: AgentTaskConstraint = {
  id: "c1",
  kind: "limit",
  text: words,
  source: words
}
const requirement: AgentTaskRequirement = {
  id: "r1",
  kind: "change",
  text: "Book selected hotel",
  source: "Book a room for Ada, one night."
}
const target = {
  committingLabel: true,
  accessibleName: "Book one night",
  offerScope: {
    record: "Garden Hotel",
    text: "Garden Hotel Nightly rate: 110 credits Rating: 4 stars Guest name Book one night"
  }
}

describe("control-bound displayed price limits", () => {
  it("allows the same-unit nightly cap and preserves a separate unconditional ban", () => {
    expect(agentPriceLimitHolds(cap, target, requirement)).toBe(true)
    expect(
      agentForbiddingConstraints(
        { semanticEffects: ["activation"], target },
        [cap],
        [],
        requirement
      )
    ).toEqual([])
    const ban = { ...cap, forbids: ["payment" as const] }
    expect(
      agentForbiddingConstraints(
        { semanticEffects: ["activation"], target },
        [ban],
        [],
        requirement
      )
    ).toHaveLength(1)
  })
  it.each(["121", "130", "120.01"])("refuses the rate %s", (price) => {
    expect(
      agentPriceLimitHolds(
        cap,
        {
          ...target,
          offerScope: {
            ...target.offerScope,
            text: target.offerScope.text.replace("110", price)
          }
        },
        requirement
      )
    ).toBe(false)
  })
  it.each([
    "Don't book anything over 120.50 credits a night.",
    "Spend at most 120.50 credits per night."
  ])("parses cents without dropping the fractional bound: %s", (text) => {
    expect(agentPriceLimit(text)).toMatchObject({
      cents: 12050,
      basis: "night",
      inclusive: true
    })
  })
  it("keeps strict vs inclusive caps and does not convert currencies or bases", () => {
    for (const text of [
      "Under 110 credits per night.",
      "Don't book anything over 120 USD a night.",
      "Spend at most 120 credits."
    ]) {
      expect(
        agentPriceLimitHolds(
          { ...cap, text, source: text },
          target,
          requirement
        )
      ).toBe(false)
    }
    expect(
      agentPriceLimitHolds(
        {
          ...cap,
          text: words.replace("120", "110"),
          source: words.replace("120", "110")
        },
        target,
        requirement
      )
    ).toBe(true)
  })
  it.each([
    undefined,
    { ...target, offerScope: undefined },
    { ...target, accessibleName: "Book two nights" },
    { ...target, accessibleName: "Book" }
  ])("refuses missing or mismatched control/quantity binding: %j", (value) => {
    expect(agentPriceLimitHolds(cap, value, requirement)).toBe(false)
  })
  it.each([
    "From 110 credits",
    "Nightly rate: 110 credits plus fees",
    "Nightly rate: 110 credits Total: 220 credits",
    "Nightly rate: 110 USD",
    "Nightly rate: 110 credits excluding tax",
    "Nightly rate: 110 USDollars",
    "Nightly rate: 110 credits per day"
  ])("refuses ambiguous terms: %s", (text) => {
    expect(
      agentPriceLimitHolds(
        cap,
        {
          ...target,
          offerScope: {
            record: "Garden Hotel",
            text: `Garden Hotel ${text} Book one night`
          }
        },
        requirement
      )
    ).toBe(false)
  })
  it("requires an exact user-source cap, rather than a planner's different bound", () => {
    expect(
      agentConstraintPriceLimit({ ...cap, text: words.replace("120", "130") })
    ).toBeUndefined()
    expect(
      agentConstraintPriceLimit({ ...cap, source: undefined })
    ).toBeUndefined()
    expect(
      agentPriceLimit(
        "Don't book anything over 120 credits a night including fees"
      )
    ).toBeUndefined()
    expect(
      agentPriceLimit("Don't pay anything until I confirm")
    ).toBeUndefined()
  })
  it("refuses a possible commit under an unknown monetary limit", () => {
    expect(
      agentForbiddingConstraints(
        { semanticEffects: ["activation"], target: { committingLabel: true } },
        [cap],
        [],
        requirement
      )
    ).toHaveLength(1)
    expect(
      agentForbiddingConstraints(
        { semanticEffects: ["activation"], target },
        [{ ...cap, text: "Spend under $120", source: "Spend under $120" }],
        [],
        requirement
      )
    ).toHaveLength(1)
  })
})

it("does not infer a money limit from another clause in a broad source quote", () => {
  expect(
    agentForbiddingConstraints(
      { semanticEffects: ["activation"], target: { committingLabel: true } },
      [
        {
          id: "once",
          kind: "limit",
          text: "Submit only once",
          source: `Submit only once. ${words}`
        }
      ]
    )
  ).toEqual([])
})

it.each(["USD", "EUR", "GBP"])(
  "checks %s without currency conversion",
  (currency) => {
    const text = words.replace("credits", currency)
    expect(
      agentPriceLimitHolds(
        { ...cap, text, source: text },
        {
          ...target,
          offerScope: {
            ...target.offerScope,
            text: target.offerScope.text.replace("credits", currency)
          }
        },
        requirement
      )
    ).toBe(true)
  }
)

it("keeps decimal minor units exact through the safe integer boundary", () => {
  expect(
    agentPriceLimit("Spend at most 90071992547409.91 credits")
  ).toMatchObject({ cents: Number.MAX_SAFE_INTEGER })
  expect(
    agentPriceLimit("Spend at most 90071992547409.92 credits")
  ).toBeUndefined()
  expect(agentPriceLimit("Spend at most 0.29 credits")).toMatchObject({
    cents: 29
  })
})
