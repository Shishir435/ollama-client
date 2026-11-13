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
  text: "Book Garden Hotel",
  source: "Book a room at Garden Hotel for Ada, one night."
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

describe("reviewer counterexamples for displayed price terms", () => {
  const withTerms = (text: string, record = "Garden Hotel") => ({
    ...target,
    offerScope: { record, text: `${record} ${text} Book one night` }
  })
  const totalCap = "Spend at most 120 credits."
  const total = { ...cap, text: totalCap, source: totalCap }
  it("reads a whole Total label, not the end of Subtotal", () => {
    expect(
      agentPriceLimitHolds(total, withTerms("Total: 110 credits"), requirement)
    ).toBe(true)
    expect(
      agentPriceLimitHolds(
        total,
        withTerms("Subtotal: 110 credits"),
        requirement
      )
    ).toBe(false)
  })
  it.each([
    "Total: 110 credits per month",
    "Total: 110 credits a week",
    "Total: 110 credits / guest",
    "Total: 110 credits monthly"
  ])("refuses an unmodelled rate suffix: %s", (text) => {
    expect(agentPriceLimitHolds(total, withTerms(text), requirement)).toBe(
      false
    )
  })
  it.each([
    "Nightly rate: 110 USD Cleaning: $50",
    "Nightly rate: 110 USD Cleaning: USD 50",
    "Nightly rate: 110 USD Cleaning: 50 dollars"
  ])("treats any further displayed money as ambiguous: %s", (text) => {
    const usd = words.replace("credits", "USD")
    expect(
      agentPriceLimitHolds(
        { ...cap, text: usd, source: usd },
        withTerms(text),
        requirement
      )
    ).toBe(false)
  })
  it("binds the offer record to the record the requirement names", () => {
    const other = withTerms("Nightly rate: 110 credits", "Other Hotel")
    expect(agentPriceLimitHolds(cap, other, requirement)).toBe(false)
    expect(
      agentPriceLimitHolds(
        cap,
        withTerms("Nightly rate: 110 credits"),
        requirement
      )
    ).toBe(true)
    expect(
      agentPriceLimitHolds(cap, other, {
        ...requirement,
        text: "Book hotel",
        items: ["Garden Hotel"]
      })
    ).toBe(false)
  })
  it("refuses a lone offer on the wrong page, which names no rival either", () => {
    // The requested hotel is not on this page; nothing else here is named.
    const lone = withTerms("Nightly rate: 110 credits", "Other Hotel")
    expect(agentPriceLimitHolds(cap, lone, requirement)).toBe(false)
    expect(agentPriceLimitHolds(cap, lone, requirement, "Garden Hotel")).toBe(
      false
    )
  })
  it("binds an unnamed choice only to the record the runtime's comparison selected", () => {
    const cheapest = {
      ...requirement,
      text: "Book the cheapest hotel",
      source: "Book the cheapest hotel for Ada, one night."
    }
    const other = withTerms("Nightly rate: 110 credits", "Other Hotel")
    // The model's tag or a lack of rivals selects nothing.
    expect(agentPriceLimitHolds(cap, other, cheapest)).toBe(false)
    expect(agentPriceLimitHolds(cap, other, cheapest, "Garden Hotel")).toBe(
      false
    )
    expect(agentPriceLimitHolds(cap, other, cheapest, "Other Hotel")).toBe(true)
  })
  it.each([
    "Spend under USD 120",
    "Spend under 120 dollars",
    "Under 120 dollars per night",
    "Keep it below 1,200 euros",
    "No more than ¥12000"
  ])(
    "keeps an unparsed money bound effective on a possible commit: %s",
    (text) => {
      expect(
        agentForbiddingConstraints(
          { semanticEffects: ["activation"], target },
          [{ ...cap, text, source: text }],
          [],
          requirement
        )
      ).toHaveLength(1)
    }
  )
  it("does not treat a count without money as a monetary bound", () => {
    expect(
      agentForbiddingConstraints(
        { semanticEffects: ["activation"], target },
        [
          {
            ...cap,
            text: "Book at most 2 nights",
            source: "Book at most 2 nights"
          }
        ],
        [],
        requirement
      )
    ).toEqual([])
  })
})
