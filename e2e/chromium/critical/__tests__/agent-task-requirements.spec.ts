import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * The gate a planned run has to pass, in a real browser.
 *
 * A form with two fields and a submit. The run fills one, submits, and claims
 * the task. Submitting is a mutation and the verifier confirms it, so the
 * previous judge selected that step, saw its own intended result confirmed,
 * and accepted the whole task — an empty second field and all.
 */
const FORM_PAGE = `<!doctype html>
<title>Contact</title>
<main>
  <p id="status">Nothing submitted</p>
  <label>Name <input id="name" /></label>
  <label>Address <input id="address" /></label>
  <button type="button" onclick="
    document.getElementById('status').textContent =
      'Submitted for ' + (document.getElementById('name').value || 'nobody');
  ">Submit</button>
</main>`

const fill = (
  observation: AgentFixtureObservation,
  name: string,
  text: string
) => ({
  type: "type",
  ref: agentFixtureElement(
    observation,
    (element) => element.name?.includes(name) === true
  )?.ref,
  text
})

runAgentScenario({
  name: "requirements-partial",
  goal: "Put Alice in the name field and Baker Street in the address field, then submit.",
  status: "partial",
  html: () => FORM_PAGE,
  plan: [
    { text: "the name field holds Alice", kind: "change" },
    { text: "the address field holds Baker Street", kind: "change" },
    { text: "the form is submitted", kind: "change" }
  ],
  /**
   * Deliberately lazy: it fills one field, submits, and reports all three
   * outcomes met. Two of the three claims quote text the page does not carry.
   */
  decide: (observation: AgentFixtureObservation, { step }) => {
    if (step === 1) return fill(observation, "Name", "Alice")
    if (step === 2) {
      const submit = agentFixtureElement(
        observation,
        (element) => element.name === "Submit"
      )
      return { type: "click", ref: submit?.ref }
    }
    /**
     * The over-claim. Refused on evidence, because the page says nothing
     * about Baker Street — so the run has to come back and answer honestly.
     */
    if (step === 3) {
      return {
        type: "complete",
        summary: "Filled the form and submitted it.",
        outcomes: [
          { id: "r1", met: true, evidence: "Alice" },
          { id: "r2", met: true, evidence: "Baker Street" },
          { id: "r3", met: true, evidence: "Submitted for Alice" }
        ]
      }
    }
    return {
      type: "complete",
      summary: "Filled the name and submitted; the address is still empty.",
      outcomes: [
        { id: "r1", met: true, evidence: "Alice" },
        { id: "r2", met: false },
        { id: "r3", met: true, evidence: "Submitted for Alice" }
      ]
    }
  },
  verify: async ({ page, snapshot }) => {
    await expect(page.locator("#address")).toHaveValue("")
    /** Not `completed`. The panel reads a status before it reads a summary. */
    expect(snapshot?.run?.status).toBe("partial")
    expect(snapshot?.run?.outcome).toEqual({
      met: ["r1", "r3"],
      unmet: ["r2"]
    })
    /** The dishonest claim was refused before the honest one was accepted. */
    expect(
      snapshot?.steps.some(
        (entry) =>
          entry.status === "rejected" &&
          entry.verification?.evidence?.kind === "completion"
      )
    ).toBe(true)
  }
})

/**
 * The other half of the gate: a run that does everything asked still finishes
 * cheaply. A completion rule that only ever refuses is not a working gate,
 * and every extra round trip here is paid by every ordinary task.
 */
runAgentScenario({
  name: "requirements-complete",
  goal: "Put Alice in the name field, then submit.",
  status: "completed",
  html: () => FORM_PAGE,
  plan: [
    { text: "the name field holds Alice", kind: "change" },
    { text: "the form is submitted", kind: "change" }
  ],
  decide: (observation: AgentFixtureObservation, { step }) => {
    if (step === 1) return fill(observation, "Name", "Alice")
    if (step === 2) {
      const submit = agentFixtureElement(
        observation,
        (element) => element.name === "Submit"
      )
      return { type: "click", ref: submit?.ref }
    }
    return {
      type: "complete",
      summary: "Filled the name and submitted.",
      outcomes: [
        { id: "r1", met: true, evidence: "Alice" },
        { id: "r2", met: true, evidence: "Submitted for Alice" }
      ]
    }
  },
  verify: async ({ snapshot, wire }) => {
    expect(snapshot?.run?.status).toBe("completed")
    expect(snapshot?.run?.outcome).toEqual({ met: ["r1", "r2"], unmet: [] })
    /**
     * Three decisions and one plan. A planned run that goes right must not
     * cost the loop an extra lap, so this is pinned rather than described.
     */
    expect(wire.filter((entry) => entry.decision !== undefined)).toHaveLength(3)
  }
})
