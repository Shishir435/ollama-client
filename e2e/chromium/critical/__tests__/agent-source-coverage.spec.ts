import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

for (const wrongSource of [false, true]) {
  runAgentScenario({
    name: `source-coverage-${wrongSource ? "wrong-page" : "complete"}`,
    goal: "Read every source link and report its code.",
    plan: [
      { text: "Read every source link and report its code", kind: "read" }
    ],
    status: wrongSource ? "failed" : "completed",
    html: (path) => {
      if (path.startsWith("/source/1"))
        return `<!doctype html><main><h1>Offer 1</h1><p>Offer 1 code: CODE-1</p>${wrongSource ? "<p>Offer 2 code: CODE-2</p>" : '<a href="/source/2">Offer 2</a>'}</main>`
      if (path.startsWith("/source/2"))
        return "<!doctype html><main><h1>Offer 2</h1><p>Offer 2 code: CODE-2</p></main>"
      return '<!doctype html><main><a href="/source/1">Offer 1</a><a href="/source/2">Offer 2</a></main>'
    },
    decide: (observation, { step }) => {
      if (step === 1 || (!wrongSource && step === 3))
        return {
          type: "click",
          requirementId: "r1",
          ref: agentFixtureElement(
            observation,
            (element) => element.name === `Offer ${step === 1 ? 1 : 2}`
          )?.ref
        }
      if (step === 2 || (!wrongSource && step === 4)) {
        const indices = wrongSource ? [1, 2] : [step === 2 ? 1 : 2]
        return {
          type: "read",
          finding: indices.map((i) => `Offer ${i} code: CODE-${i}`).join("; "),
          sourceQuotes: indices.map((i) => ({
            requirementId: "r1",
            quote: `Offer ${i} code: CODE-${i}`
          }))
        }
      }
      if (wrongSource && step > 3)
        return {
          type: "complete",
          summary: "Could not read every source page.",
          outcomes: [{ id: "r1", met: false }]
        }
      return {
        type: "complete",
        summary: "Offer 1 code: CODE-1. Offer 2 code: CODE-2.",
        outcomes: [
          {
            id: "r1",
            met: true,
            items: [1, 2].map((i) => ({
              index: i - 1,
              met: true,
              evidence: `Offer ${i} code: CODE-${i}`
            }))
          }
        ]
      }
    },
    // Even a permissive reviewer cannot substitute for missing source coverage.
    review: (evidence) => [
      { id: "r1", verdict: "supported", sources: evidence.map(({ id }) => id) }
    ],
    verify: ({ snapshot }) => {
      expect(snapshot?.run?.requirements?.[0]).toMatchObject({
        pageItemsComplete: true,
        items: ["Offer 1", "Offer 2"]
      })
      if (wrongSource) {
        expect(snapshot?.run?.outcome?.unmet).toContain("r1")
        expect(
          snapshot?.steps.some(
            (entry) =>
              entry.status === "rejected" &&
              entry.verification?.evidence?.summary?.includes(
                "own enumerated source"
              )
          )
        ).toBe(true)
      } else {
        expect(snapshot?.run?.outcome?.met).toContain("r1")
      }
    }
  })
}
