import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const offered = new Set<string>()
const first = (key: string) => {
  const fresh = !offered.has(key)
  offered.add(key)
  return fresh
}
const pageQuote = (page: number) => `Application for Record 5, page ${page}`
const receipt = "Record 5 Saved Confirmation code: QF-5-729"

/**
 * Measured live: Next was tagged to the review and Submit to the change, so
 * page three was left with nothing kept, and the run then went back from
 * the result page without keeping the confirmation. Each departure is now
 * reminded once; the quotes kept on the retry are what the reviewer reads
 * after the run has left the result page, and Submit still runs once.
 */
runAgentScenario({
  name: "arrival-retention-across-submit",
  goal: "Complete the application for Record 5. Review all pages, then submit it once.",
  plan: [
    { text: "Review all pages", kind: "read" },
    {
      text: "Submit the application for Record 5 once",
      kind: "change",
      check: { type: "record_state", record: "Record 5", state: "submitted" }
    }
  ],
  status: "completed",
  html: (path) =>
    path.startsWith("/result")
      ? `<!doctype html><title>Application</title><main><h1>Record 5</h1>
        <p>Saved</p><p>Confirmation code: QF-5-729</p></main>`
      : (() => {
          const page = Number(path.match(/\/page-(\d)/)?.[1] ?? 1)
          return `<!doctype html><title>Application</title><main>
            <h1>${pageQuote(page)}</h1><p>Reviewed section ${page}</p>
            ${
              page < 3
                ? `<button type="button" onclick="location.href='/page-${page + 1}'">Next</button>`
                : `<button type="button" onclick="fetch('/effect',{method:'POST'}).then(()=>location.href='/result')">Submit application</button>`
            }</main>`
        })(),
  decide: (observation) => {
    const path = new URL(observation.url).pathname
    const ref = (name: string) =>
      agentFixtureElement(observation, (element) => element.name === name)?.ref
    if (path.startsWith("/result"))
      return first("result")
        ? { type: "back", requirementId: "r1" }
        : {
            type: "back",
            requirementId: "r1",
            sourceQuotes: [{ quote: receipt, requirementId: "r2" }]
          }
    const page = Number(path.match(/\/page-(\d)/)?.[1] ?? 1)
    if (page < 3)
      return {
        type: "click",
        ref: ref("Next"),
        requirementId: "r1",
        sourceQuotes: [{ quote: pageQuote(page), requirementId: "r1" }]
      }
    if (!offered.has("result"))
      return first("page-3")
        ? { type: "click", ref: ref("Submit application"), requirementId: "r2" }
        : {
            type: "click",
            ref: ref("Submit application"),
            requirementId: "r2",
            sourceQuotes: [{ quote: pageQuote(3), requirementId: "r1" }],
            prerequisiteOutcomes: [
              { id: "r1", met: true, evidence: pageQuote(3) }
            ]
          }
    return {
      type: "complete",
      summary: "Reviewed pages 1 to 3 and submitted the application once.",
      outcomes: [
        { id: "r1", met: true, evidence: pageQuote(3) },
        { id: "r2", met: true, evidence: receipt }
      ]
    }
  },
  review: (evidence) => {
    const pages = evidence.filter((record) =>
      [1, 2, 3].some((page) => record.quote === pageQuote(page))
    )
    const saved = evidence.filter((record) => record.quote === receipt)
    return [
      {
        id: "r1",
        verdict:
          new Set(pages.map((record) => record.quote)).size === 3
            ? "supported"
            : "insufficient_evidence",
        sources: pages.map(({ id }) => id)
      },
      {
        id: "r2",
        verdict: saved.length ? "supported" : "insufficient_evidence",
        sources: saved.map(({ id }) => id)
      }
    ]
  },
  verify: async ({ snapshot, effects }) => {
    expect(effects()).toBe(1)
    expect(snapshot?.run?.outcome?.supported).toEqual(["r1", "r2"])
    const refusals = (snapshot?.steps ?? [])
      .filter((step) => step.status === "rejected")
      .map((step) => step.verification?.evidence.summary ?? "")
    expect(
      refusals.filter((summary) =>
        summary.includes("You reached this page by advancing r1")
      )
    ).toHaveLength(1)
    expect(
      refusals.filter((summary) =>
        summary.includes("appeared after the confirmed step for r2")
      )
    ).toHaveLength(1)
    expect(
      snapshot?.run?.evidenceLedger?.some(
        (record) =>
          record.kind === "observed_fact" &&
          record.requirementId === "r2" &&
          record.quote === receipt
      )
    ).toBe(true)
  }
})
