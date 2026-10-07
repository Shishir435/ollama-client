import { runAgentScenario } from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * Independent completion review, through the real extension and provider
 * wire.
 *
 * The answer is a paraphrase: the page says "rose to 4.2 million", the model
 * reports "$4.2M". Exact matching cannot decide that, so the judge asks the
 * reviewer, which is a separate provider request answered off the scripted
 * step counter. A reviewer that cites the grounded record settles the run.
 * One that cites a record the runtime never grounded settles nothing, and the
 * run asks the user exactly as it did before review existed.
 */
const REPORT_PAGE = `<!doctype html>
<title>Quarterly report</title>
<main>
  <h1>Quarterly report</h1>
  <p>Quarterly revenue rose to 4.2 million.</p>
</main>`

const QUOTE = "Quarterly revenue rose to 4.2 million"

const paraphrase = {
  type: "complete",
  summary: "Revenue was $4.2M this quarter.",
  sourceQuotes: [{ quote: QUOTE, requirementId: "r1" }],
  outcomes: [
    { id: "r1", met: true, evidence: "Revenue was $4.2M this quarter" }
  ]
}

runAgentScenario({
  name: "completion-review-supports-a-paraphrased-read",
  goal: "Tell me the quarterly revenue.",
  plan: [{ text: "report the quarterly revenue", kind: "read" }],
  status: "completed",
  html: () => REPORT_PAGE,
  decide: () => paraphrase,
  review: (evidence) => [
    {
      id: "r1",
      verdict: "supported",
      sources: evidence
        .filter((record) => record.quote === QUOTE)
        .map((record) => record.id)
        .slice(0, 1)
    }
  ],
  verify: async ({ snapshot, phases, reviews, effects }) => {
    expect(snapshot?.run?.status).toBe("completed")
    expect(snapshot?.run?.outcome).toEqual({ met: ["r1"], unmet: [] })
    expect(reviews()).toBe(1)
    expect(effects()).toBe(0)
    expect(phases).toContainEqual(
      expect.objectContaining({
        phase: "completion_reviewed",
        outcome: "accepted",
        disagreements: 0
      })
    )
    expect(
      snapshot?.steps.find((step) => step.stepId.includes(":review:"))
        ?.telemetry
    ).toMatchObject({ reviews: 1, reviewDisagreements: 0 })
  }
})

runAgentScenario({
  name: "completion-review-cannot-pass-on-an-ungrounded-citation",
  goal: "Tell me the quarterly revenue.",
  plan: [{ text: "report the quarterly revenue", kind: "read" }],
  status: "paused",
  completionReview: true,
  html: () => REPORT_PAGE,
  decide: () => paraphrase,
  review: () => [
    { id: "r1", verdict: "supported", sources: ["a-record-nobody-grounded"] }
  ],
  verify: async ({ snapshot, phases, reviews }) => {
    expect(snapshot?.run?.status).toBe("paused")
    expect(reviews()).toBe(2)
    expect(phases).toContainEqual(
      expect.objectContaining({
        phase: "completion_reviewed",
        outcome: "needs_review",
        disagreements: 1
      })
    )
  }
})
