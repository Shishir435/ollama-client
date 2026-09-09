import {
  AGENT_DETAILS_PAGE,
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const formPage =
  '<!doctype html><title>Agent form</title><main><h1>Account</h1><form action="/details"><label for="name">Name</label><input id="name" name="name"><button>Continue</button></form></main>'

runAgentScenario({
  name: "form",
  goal: "Enter Alice in the Name field, continue, and tell me the status.",
  status: "completed",
  hosted: true,
  html: (path) => (path.startsWith("/details") ? AGENT_DETAILS_PAGE : formPage),
  decide(observation) {
    if (observation.text.includes("Status: Active"))
      return { type: "complete", summary: "Active" }
    const field = agentFixtureElement(
      observation,
      (element) => element.tag === "input"
    )
    if (field && field.value !== "Alice")
      return { type: "clear_and_type", ref: field.ref, text: "Alice" }
    return {
      type: "click",
      ref: agentFixtureElement(
        observation,
        (element) => element.name === "Continue"
      )?.ref
    }
  },
  async verify({ page, snapshot, wire }) {
    await expect(page.getByText("Status: Active")).toBeVisible()
    expect(snapshot?.run?.result).toContain("Active")
    expect(snapshot?.run?.observationCount).toBeGreaterThanOrEqual(3)
    expect(
      snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual([expect.stringMatching(/^(type|clear_and_type)$/), "click"])
    expect(wire.length).toBeGreaterThanOrEqual(3)
  }
})
