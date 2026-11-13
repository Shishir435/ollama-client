import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

runAgentScenario({
  name: "read-phase-before-two-writes",
  goal: "Read the Account code, then set Destination to AC17 and set Backup to AC17.",
  plan: [
    {
      text: "Read the Account code",
      kind: "read",
      check: { type: "row", record: "Account" }
    },
    {
      text: "Destination holds AC17",
      kind: "change",
      check: { type: "field", name: "Destination", value: "AC17" }
    },
    {
      text: "Backup holds AC17",
      kind: "change",
      check: { type: "field", name: "Backup", value: "AC17" }
    }
  ],
  status: "completed",
  html: () =>
    '<!doctype html><main><h1>Account</h1><p>Account code: AC17</p><label>Destination<input id="destination"></label><label>Backup<input id="backup"></label></main>',
  decide: (observation, { step }) => {
    if (step === 1) return { type: "extract_text", offset: 0 }
    step -= 1
    if (step <= 3) {
      const name = step === 3 ? "Backup" : "Destination"
      return {
        type: "type",
        ref: agentFixtureElement(
          observation,
          (element) => element.name === name
        )?.ref,
        text: "AC17",
        requirementId: step === 3 ? "r3" : "r2",
        // First attempt is deliberately premature. The second supplies proof;
        // the third must use the durable read-phase receipt without rereading.
        ...(step === 2
          ? {
              prerequisiteOutcomes: [
                { id: "r1", met: true, evidence: "Account code: AC17" }
              ]
            }
          : {})
      }
    }
    return {
      type: "complete",
      summary: "Read the account code and filled both destinations with AC17.",
      outcomes: [
        // The proof settles the read only for the answer it established.
        { id: "r1", met: true, evidence: "Account code: AC17" },
        { id: "r2", met: true, evidence: "AC17" },
        { id: "r3", met: true, evidence: "AC17" }
      ]
    }
  },
  verify: async ({ page, snapshot }) => {
    await expect(page.locator("#destination")).toHaveValue("AC17")
    await expect(page.locator("#backup")).toHaveValue("AC17")
    expect(snapshot?.run?.requirements?.[0].beforeChanges).toBe(true)
    expect(
      snapshot?.steps.filter((step) => step.status === "rejected")
    ).toHaveLength(1)
    expect(
      snapshot?.steps.find((step) => step.status === "rejected")?.verification
        ?.evidence?.summary
    ).toContain("Read-before-write")
    expect(snapshot?.run?.outcome?.met).toEqual(["r1", "r2", "r3"])
  }
})

for (const supported of [true, false]) {
  runAgentScenario({
    name: `read-phase-review-${supported ? "supported" : "uncited"}`,
    goal: "Review the delivery policy, then set Destination to Ada.",
    plan: [
      { text: "Review the delivery policy", kind: "read" },
      {
        text: "Destination holds Ada",
        kind: "change",
        check: { type: "field", name: "Destination", value: "Ada" }
      }
    ],
    status: supported ? "completed" : "failed",
    html: () =>
      '<!doctype html><main><h1>Delivery policy</h1><p>Packages arrive within three days.</p><label>Destination<input id="destination"></label></main>',
    decide: (observation, { step }) => {
      if (step === 1)
        return {
          type: "type",
          ref: agentFixtureElement(
            observation,
            (element) => element.name === "Destination"
          )?.ref,
          text: "Ada",
          requirementId: "r2",
          prerequisiteOutcomes: [
            {
              id: "r1",
              met: true,
              evidence: "Packages arrive within three days."
            }
          ]
        }
      return {
        type: "complete",
        summary: supported
          ? "Reviewed the delivery policy and filled Destination."
          : "Could not establish the review; left Destination unchanged.",
        outcomes: supported
          ? [
              {
                id: "r1",
                met: true,
                evidence: "Packages arrive within three days."
              },
              { id: "r2", met: true, evidence: "Ada" }
            ]
          : [
              { id: "r1", met: false },
              { id: "r2", met: false }
            ]
      }
    },
    review: (evidence) => [
      {
        id: "r1",
        verdict: "supported",
        sources: supported
          ? evidence
              .filter(
                (record) =>
                  record.quote === "Packages arrive within three days."
              )
              .map(({ id }) => id)
          : ["invented-source"]
      }
    ],
    verify: async ({ page, snapshot, reviews }) => {
      await expect(page.locator("#destination")).toHaveValue(
        supported ? "Ada" : ""
      )
      expect(reviews()).toBeGreaterThan(0)
      if (supported) {
        expect(snapshot?.run?.outcome?.supported).toContain("r1")
        expect(snapshot?.run?.outcome?.claimed ?? []).not.toContain("r1")
      } else {
        expect(snapshot?.steps.some((step) => step.status === "rejected")).toBe(
          true
        )
      }
    }
  })
}
