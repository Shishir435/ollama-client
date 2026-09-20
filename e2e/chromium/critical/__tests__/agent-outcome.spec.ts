import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * A save that lands late, in a real browser.
 *
 * The click is delivered and its effect is confirmed — the button was pressed
 * and the page changed — while the document is still saving. A run that
 * treated a confirmed activation as the goal being met reported success here
 * every time; this asserts it cannot, that the refusal reaches the run's own
 * record, and that the completion it finally makes is the one the page
 * supports.
 */
const SAVE_PAGE = `<!doctype html>
<title>Editor</title>
<main>
  <p id="status">Unsaved changes</p>
  <button type="button" onclick="
    document.getElementById('status').textContent = 'Saving…';
    this.disabled = true;
    setTimeout(() => {
      document.getElementById('status').textContent = 'All changes saved';
    }, 1200);
  ">Save</button>
</main>`

runAgentScenario({
  name: "outcome-evidence",
  goal: "Save the document.",
  status: "completed",
  html: () => SAVE_PAGE,
  /**
   * Driven off what the page says rather than a decision counter, so a retry
   * behaves like a first attempt: the counter carried across retries and made
   * the second run skip the over-claim this scenario exists to catch.
   */
  decide: (observation: AgentFixtureObservation, { step }) => {
    if (observation.text.includes("All changes saved")) {
      return {
        type: "complete",
        summary: "Saved the document.",
        evidence: "All changes saved"
      }
    }
    if (observation.text.includes("Unsaved changes")) {
      const save = agentFixtureElement(
        observation,
        (element) => element.name === "Save"
      )
      return { type: "click", ref: save?.ref }
    }
    /**
     * Saving. The first claim here is the one a run used to be able to make:
     * the button was pressed, so the job must be done. It carries no evidence
     * and the page shows none, so it is refused and the run holds instead.
     */
    return step === 2
      ? { type: "complete", summary: "Saved the document." }
      : { type: "wait", condition: "All changes saved", timeoutMs: 8_000 }
  },
  verify: async ({ page, snapshot, phases }) => {
    await expect(page.locator("#status")).toHaveText("All changes saved")
    expect(snapshot?.run?.status).toBe("completed")
    // The over-claim is refused, and the run's own record says so rather than
    // the refusal living only in the model's next prompt.
    expect(
      phases.filter((phase) => phase.phase === "completion_refused")
    ).toHaveLength(1)
    expect(
      snapshot?.steps.some((agentStep) => agentStep.status === "rejected")
    ).toBe(true)
  }
})
