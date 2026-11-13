import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

for (const variant of [
  "within",
  "over",
  "unknown-quantity",
  "changed"
] as const) {
  const allowed = variant === "within"
  runAgentScenario({
    name: `bound-booking-price-${variant}`,
    goal: "Book Garden Hotel for Ada for one night. Don't book anything over 120 credits a night.",
    plan: [{ text: "Book Garden Hotel for Ada for one night", kind: "change" }],
    status: allowed ? "completed" : "paused",
    html: () =>
      `<!doctype html><main><h1>Garden Hotel</h1><p id="rate">Nightly rate: ${variant === "over" ? 130 : 110} credits</p><label>Guest name <input></label>${variant === "unknown-quantity" ? "<label>Nights<select><option>2</option></select></label>" : ""}<button onclick="fetch('/effect');document.querySelector('main').insertAdjacentHTML('beforeend','<p>Booked Garden Hotel</p>');this.remove()">Book one night</button></main>`,
    decide: async (observation, { step, page }) => {
      if (step === 1)
        return {
          type: "clear_and_type",
          ref: agentFixtureElement(observation, (e) => e.name === "Guest name")
            ?.ref,
          text: "Ada",
          requirementId: "r1"
        }
      if (step === 2) {
        if (variant === "changed")
          await page.locator("#rate").evaluate((node) => {
            node.textContent = "Nightly rate: 130 credits"
          })
        return {
          type: "click",
          ref: agentFixtureElement(
            observation,
            (e) => e.name === "Book one night"
          )?.ref,
          requirementId: "r1"
        }
      }
      if (!allowed)
        return {
          type: "ask_user",
          question:
            "The booking price or quantity cannot be established within your cap. Please review the offer."
        }
      return {
        type: "complete",
        summary:
          "Booked Garden Hotel for Ada for one night at the displayed rate of 110 credits.",
        outcomes: [
          { id: "r1", met: true, evidence: "Booked Garden Hotel" },
          { id: "c1", met: true, evidence: "Nightly rate: 110 credits" }
        ],
        sourceQuotes: [
          { requirementId: "r1", quote: "Booked Garden Hotel" },
          { requirementId: "c1", quote: "Nightly rate: 110 credits" }
        ]
      }
    },
    review: (evidence) =>
      ["r1", "c1"].map((id) => ({
        id,
        verdict: "supported",
        sources: evidence.filter((e) => e.for === id).map((e) => e.id)
      })),
    verify: ({ snapshot, effects }) => {
      expect(effects()).toBe(allowed ? 1 : 0)
      expect(snapshot?.run?.constraints?.[0]).toMatchObject({ kind: "limit" })
      expect(snapshot?.run?.constraints?.[0].forbids).toBeUndefined()
      const rejected = snapshot?.steps.filter(
        (s) => s.status === "rejected" || s.status === "failed"
      )
      expect(rejected).toHaveLength(allowed ? 0 : 1)
      if (variant === "changed")
        expect(rejected?.[0].verification?.evidence?.summary).toContain(
          "offerScope"
        )
    }
  })
}
