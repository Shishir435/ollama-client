import {
  AGENT_DETAILS_PAGE,
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const linkPage =
  '<!doctype html><title>Agent details</title><main><a href="/details">Details</a></main>'

runAgentScenario({
  name: "details",
  goal: "Open Details and tell me the status.",
  status: "completed",
  hosted: true,
  html: (path) => (path.startsWith("/details") ? AGENT_DETAILS_PAGE : linkPage),
  // Real sites acknowledge navigation before the document finishes loading.
  navigationDelayMs: (path) => (path.startsWith("/details") ? 1_500 : 0),
  decide(observation) {
    if (observation.text.includes("Status: Active"))
      return { type: "complete", summary: "Active" }
    return {
      type: "click",
      ref: agentFixtureElement(
        observation,
        (element) => element.name === "Details"
      )?.ref
    }
  },
  async verify({ page, snapshot, wire }) {
    await expect(page.getByText("Status: Active")).toBeVisible()
    expect(snapshot?.run?.result).toContain("Active")
    expect(snapshot?.run?.observationCount).toBeGreaterThanOrEqual(2)
    /**
     * The goal and the safety invariants, not the verb. A hosted model may
     * legitimately navigate to the href it can see rather than click the link,
     * and asserting the mechanism made a correct run look like a failure.
     */
    const verified = snapshot?.steps.filter(
      (step) => step.status === "verified"
    )
    expect(verified).toHaveLength(1)
    expect(verified?.[0]?.command?.type).toMatch(/^(click|navigate)$/)
    expect(verified?.[0]?.sourceUrl).toContain("127.0.0.1")
    expect(wire.length).toBeGreaterThanOrEqual(2)
  }
})
