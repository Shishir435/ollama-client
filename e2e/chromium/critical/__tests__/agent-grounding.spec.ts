import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * A wrong command used to end the run: the trusted resolver refused it after
 * the decision had been accepted, so the answer arrived as a failed run rather
 * than as a correction. Here the scripted model insists on clicking a checkbox
 * first, and the run has to survive that and finish the task.
 */
runAgentScenario({
  name: "grounding",
  goal: "Tick the newsletter box and report the status.",
  status: "completed",
  html: () =>
    '<!doctype html><title>Agent grounding</title><main><h1>Preferences</h1><label for="news">Newsletter</label><input id="news" type="checkbox" onchange="document.querySelector(\'main\').insertAdjacentHTML(\'beforeend\',\'<p>Status: Active</p>\')"></main>',
  decide(observation: AgentFixtureObservation, { step }) {
    if (observation.text.includes("Status: Active"))
      return { type: "complete", summary: "Active" }
    const box = agentFixtureElement(
      observation,
      (element) => element.type === "checkbox"
    )
    // A checkbox is not a button, and the first attempt says so anyway.
    return { type: step === 1 ? "click" : "check", ref: box?.ref }
  },
  async verify({ page, snapshot, wire }) {
    await expect(page.getByText("Status: Active")).toBeVisible()
    expect(snapshot?.run?.result).toContain("Active")
    expect(
      snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual(["check"])
    // The refusal cost one retry, and the retry was told why.
    const retry = wire[1]?.request as { messages: { content: string }[] }
    const refused = JSON.parse(String(retry.messages.at(-1)?.content))
    expect(refused.previousAttemptRefused).toContain(
      "Use check or uncheck on it rather than click"
    )
    expect(refused.retry).toBe(1)
  }
})
