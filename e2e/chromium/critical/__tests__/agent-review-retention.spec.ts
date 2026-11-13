import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const offered = new Set<number>()
const quote = (page: number) =>
  `Review page ${page} Reference code: RV-${page}-729`

runAgentScenario({
  name: "review-retention-before-next-buttons",
  goal: "Review all three pages and report their reference codes. Do not submit.",
  plan: [
    {
      text: "Review all three pages and report their reference codes",
      kind: "read"
    }
  ],
  status: "completed",
  html: (path) => {
    const page = Number(path.match(/\/page-(\d)/)?.[1] ?? 1)
    return `<!doctype html><title>Review</title><main><h1>Review page ${page}</h1>
      <p>Reference code: RV-${page}-729</p>
      ${page < 3 ? `<button type="button" onclick="location.href='/page-${page + 1}'">Next</button>` : ""}</main>`
  },
  decide: (observation) => {
    const page = Number(
      new URL(observation.url).pathname.match(/\/page-(\d)/)?.[1] ?? 1
    )
    if (page < 3) {
      const first = !offered.has(page)
      offered.add(page)
      return {
        type: "click",
        ref: agentFixtureElement(
          observation,
          (element) => element.name === "Next"
        )?.ref,
        requirementId: "r1",
        ...(first
          ? {}
          : { sourceQuotes: [{ quote: quote(page), requirementId: "r1" }] })
      }
    }
    return {
      type: "complete",
      summary: "The three reference codes are RV-1-729, RV-2-729 and RV-3-729.",
      sourceQuotes: [{ quote: quote(3), requirementId: "r1" }],
      outcomes: [{ id: "r1", met: true, evidence: quote(3) }]
    }
  },
  review: (evidence) => {
    const facts = evidence.filter((record) =>
      [1, 2, 3].some((page) => record.quote === quote(page))
    )
    return [
      {
        id: "r1",
        verdict:
          new Set(facts.map((record) => record.quote)).size === 3
            ? "supported"
            : "insufficient_evidence",
        sources: facts.map(({ id }) => id)
      }
    ]
  },
  verify: async ({ snapshot }) => {
    expect(snapshot?.run?.outcome?.supported).toEqual(["r1"])
    expect(
      snapshot?.steps.filter(
        (step) =>
          step.status === "rejected" &&
          step.verification?.evidence.summary.includes(
            "This activation advances r1"
          )
      )
    ).toHaveLength(2)
    expect(
      snapshot?.steps.filter(
        (step) => step.status === "verified" && step.command?.type === "click"
      )
    ).toHaveLength(2)
    for (const page of [1, 2, 3])
      expect(
        snapshot?.run?.evidenceLedger?.some(
          (record) =>
            record.kind === "observed_fact" && record.quote === quote(page)
        )
      ).toBe(true)
  }
})
