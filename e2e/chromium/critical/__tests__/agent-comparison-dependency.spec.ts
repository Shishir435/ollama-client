import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const read = "Compare the three offers linked on this page"
const quote = (i: number) =>
  `Offer ${i} price: ${[100, 90, 70][i - 1]} credits; eligible`
const outcomes = () => [
  {
    id: "r1",
    met: true,
    items: [1, 2, 3].map((i) => ({
      index: i - 1,
      met: true,
      evidence: quote(i)
    }))
  }
]

runAgentScenario({
  name: "comparison-before-choice-commit",
  goal: "Compare the three offers linked on this page and book the cheapest eligible offer.",
  plan: [
    { text: read, kind: "read" },
    {
      text: "Book the cheapest eligible offer",
      kind: "change",
      requires: [read]
    }
  ],
  status: "completed",
  html: (path) => {
    const i = Number(/^\/offer\/(\d)/.exec(path)?.[1])
    if (i)
      return `<!doctype html><main><h1>Offer ${i}</h1><p>${quote(i)}</p><button onclick="fetch('/effect');document.querySelector('main').insertAdjacentHTML('beforeend','<p>Booking confirmed: Offer ${i}</p>');this.remove()">Book offer</button></main>`
    return '<!doctype html><main><a href="/offer/1">Offer 1</a><a href="/offer/2">Offer 2</a><a href="/offer/3">Offer 3</a></main>'
  },
  decide: (observation, { step }) => {
    if (step === 1)
      return {
        type: "click",
        requirementId: "r1",
        ref: agentFixtureElement(observation, (e) => e.name === "Offer 1")?.ref
      }
    if (step === 2 || step === 4) {
      const i = step === 2 ? 1 : 2
      return {
        type: "navigate",
        url: new URL(`/offer/${i + 1}`, observation.url).href,
        requirementId: "r1",
        sourceQuotes: [{ requirementId: "r1", quote: quote(i) }]
      }
    }
    if (step === 3 || step === 5)
      return {
        type: "click",
        ref: agentFixtureElement(observation, (e) => e.name === "Book offer")
          ?.ref,
        // A different requirement tag must not let the premature commit through.
        requirementId: step === 3 ? "r1" : "r2",
        prerequisiteOutcomes: outcomes(),
        sourceQuotes: [
          { requirementId: "r1", quote: quote(step === 3 ? 2 : 3) }
        ]
      }
    return {
      type: "complete",
      summary:
        "Compared all three offers and booked Offer 3, the cheapest eligible offer at 70 credits.",
      outcomes: [
        ...outcomes(),
        { id: "r2", met: true, evidence: "Booking confirmed: Offer 3" }
      ],
      sourceQuotes: [
        { requirementId: "r2", quote: "Booking confirmed: Offer 3" }
      ]
    }
  },
  // Even a permissive reviewer cannot authorize the early two-source choice.
  review: (evidence) =>
    ["r1", "r2"].map((id) => ({
      id,
      verdict: "supported",
      sources: evidence
        .filter((record) => record.for === id)
        .map((record) => record.id)
    })),
  verify: async ({ page, snapshot, effects }) => {
    expect(effects()).toBe(1)
    await expect(page.locator("main")).toContainText(
      "Booking confirmed: Offer 3"
    )
    const requirements = snapshot?.run?.requirements
    expect(requirements?.[0]).toMatchObject({
      items: ["Offer 1", "Offer 2", "Offer 3"],
      pageItemsComplete: true
    })
    expect(requirements?.[0].beforeChanges).toBeUndefined()
    expect(requirements?.[1].requires).toEqual(["r1"])
    const refused = snapshot?.steps.filter((s) => s.status === "rejected")
    expect(refused).toHaveLength(1)
    expect(refused?.[0].verification?.evidence?.summary).toContain(
      "prerequisite"
    )
    expect(snapshot?.run?.outcome?.met).toEqual(["r1", "r2"])
  }
})

const guestQuote = (i: number) =>
  `Offer ${i} price: ${[100, 70, 90][i - 1]} credits; eligible`

/**
 * Measured live: typing the guest's name on the cheapest offer's page made
 * the first offer's price history for a current-state comparison, and every
 * Book was refused as unread. A field sent nowhere in another document does
 * not move a source this run read; no reviewer is allowed to rescue it here.
 */
runAgentScenario({
  name: "comparison-current-after-guest-entry",
  goal: "Compare the three offers linked on this page and book the cheapest eligible offer for Ada Lovelace.",
  plan: [
    { text: read, kind: "read", freshness: "current" },
    {
      text: "Book the cheapest eligible offer for Ada Lovelace",
      kind: "change",
      requires: [read]
    }
  ],
  status: "completed",
  html: (path) => {
    const i = Number(/^\/offer\/(\d)/.exec(path)?.[1])
    if (i)
      return `<!doctype html><main><h1>Offer ${i}</h1><p>${guestQuote(i)}</p><label>Guest name <input name="guest"></label><button onclick="fetch('/effect');document.querySelector('main').insertAdjacentHTML('beforeend','<p>Booking confirmed: Offer ${i}</p>');this.remove()">Book offer</button></main>`
    return '<!doctype html><main><a href="/offer/1">Offer 1</a><a href="/offer/2">Offer 2</a><a href="/offer/3">Offer 3</a></main>'
  },
  decide: (observation, { step }) => {
    if (step === 1)
      return {
        type: "click",
        requirementId: "r1",
        ref: agentFixtureElement(observation, (e) => e.name === "Offer 1")?.ref
      }
    if (step === 2 || step === 3)
      return {
        type: "navigate",
        url: new URL(`/offer/${step === 2 ? 3 : 2}`, observation.url).href,
        requirementId: "r1",
        sourceQuotes: [
          { requirementId: "r1", quote: guestQuote(step === 2 ? 1 : 3) }
        ]
      }
    if (step === 4)
      return {
        type: "fill_form",
        requirementId: "r2",
        fields: [
          {
            ref: agentFixtureElement(
              observation,
              (e) => e.name === "Guest name"
            )?.ref,
            type: "clear_and_type",
            text: "Ada Lovelace"
          }
        ]
      }
    if (step === 5)
      return {
        type: "click",
        ref: agentFixtureElement(observation, (e) => e.name === "Book offer")
          ?.ref,
        requirementId: "r2",
        prerequisiteOutcomes: [
          {
            id: "r1",
            met: true,
            items: [1, 2, 3].map((i) => ({
              index: i - 1,
              met: true,
              evidence: guestQuote(i)
            }))
          }
        ],
        sourceQuotes: [{ requirementId: "r1", quote: guestQuote(2) }]
      }
    return {
      type: "complete",
      summary:
        "Compared all three offers and booked Offer 2, the cheapest eligible offer at 70 credits, for Ada Lovelace.",
      outcomes: [
        {
          id: "r1",
          met: true,
          items: [1, 2, 3].map((i) => ({
            index: i - 1,
            met: true,
            evidence: guestQuote(i)
          }))
        },
        { id: "r2", met: true, evidence: "Booking confirmed: Offer 2" }
      ],
      sourceQuotes: [
        { requirementId: "r2", quote: "Booking confirmed: Offer 2" }
      ]
    }
  },
  // Only the booking may be reviewed: the comparison must stand on its own.
  review: (evidence) => [
    {
      id: "r2",
      verdict: "supported",
      sources: evidence
        .filter((record) => record.for === "r2")
        .map((record) => record.id)
    }
  ],
  verify: async ({ page, snapshot, effects }) => {
    expect(effects()).toBe(1)
    await expect(page.locator("main")).toContainText(
      "Booking confirmed: Offer 2"
    )
    expect(snapshot?.run?.requirements?.[0].freshness).toBe("current")
    expect(snapshot?.steps.filter((s) => s.status === "rejected")).toEqual([])
    expect(snapshot?.run?.outcome?.met).toEqual(["r1", "r2"])
  }
})
