import type { AgentPanelMessage } from "@ollama-client/contracts"

import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const approvalsAsked = (messages: AgentPanelMessage[]): number =>
  new Set(
    messages
      .map((message) =>
        message.type === "agent_snapshot" &&
        message.snapshot.pending?.kind === "approval"
          ? message.snapshot.pending.request.id
          : undefined
      )
      .filter(Boolean)
  ).size

const FIELDS = ["given", "family", "city"] as const

/**
 * Filling three fields cost three prompts, which is what trains a user to
 * approve without reading — the failure a confirmation exists to prevent.
 * One grant covers the rest, and nothing is submitted.
 *
 * The fields are deliberately not form-associated. A text input inside a
 * `<form>` is `maySubmit`, which policy raises to critical, and a critical
 * effect is never grantable at any scope — so a grant cannot currently reach
 * a classic form at all. That is policy treating "this control could submit
 * on Enter" as "this effect submits", and relaxing it is a security decision
 * rather than a fixture change.
 */
runAgentScenario({
  name: "form-prep",
  goal: "Fill in the three name fields. Do not submit.",
  status: "completed",
  approvalScope: "run_origin",
  html: () =>
    `<!doctype html><title>Agent form prep</title><main><div>${FIELDS.map(
      (field) =>
        `<label for="${field}">${field}</label><input id="${field}" name="${field}">`
    ).join("")}<button type="button">Save</button></div></main>`,
  decide(observation: AgentFixtureObservation) {
    const next = FIELDS.map((field) =>
      agentFixtureElement(observation, (element) => element.name === field)
    ).find((element) => element && !element.value)
    if (!next) {
      return {
        type: "complete",
        summary: "All three filled.",
        // The value the last edit left behind; a filled form's own evidence.
        evidence: `value-${FIELDS.at(-1)}`
      }
    }
    return { type: "clear_and_type", ref: next.ref, text: `value-${next.name}` }
  },
  async verify({ page, snapshot, messages }) {
    expect(snapshot?.run?.result).toContain("All three")

    // One prompt, then the grant covers the rest.
    expect(approvalsAsked(messages)).toBe(1)
    expect(snapshot?.run?.grants).toEqual([
      expect.objectContaining({ effects: ["form_mutation"] })
    ])

    const verified = snapshot?.steps.filter(
      (step) => step.status === "verified"
    )
    expect(verified).toHaveLength(3)
    expect(verified?.map((step) => step.command?.type)).toEqual([
      "clear_and_type",
      "clear_and_type",
      "clear_and_type"
    ])

    // Nothing submitted: the run never left the page it started on.
    expect(page.url()).not.toContain("/save")
  }
})

/**
 * A question used to pause with reason `user`, which is what a user pausing
 * looks like: the question went nowhere and nothing could answer it.
 */
runAgentScenario({
  name: "ambiguous",
  goal: "Pick the right account.",
  status: "completed",
  answer: "Use the second account.",
  html: () =>
    "<!doctype html><title>Agent ambiguous</title><main><h1>Accounts</h1><p>Two accounts exist.</p></main>",
  decide(_observation: AgentFixtureObservation, { step }) {
    if (step === 1)
      return { type: "ask_user", question: "Which of the two accounts?" }
    return { type: "complete", summary: "Used the second account." }
  },
  async verify({ snapshot, messages, wire }) {
    expect(snapshot?.run?.result).toContain("second account")
    expect(snapshot?.run?.question).toBeUndefined()
    expect(snapshot?.run?.answers).toEqual([
      expect.objectContaining({ text: "Use the second account." })
    ])
    // The question is a pause of its own kind, not the user pausing the run.
    expect(
      messages.some(
        (message) =>
          message.type === "agent_snapshot" &&
          message.snapshot.run?.pauseReason === "question"
      )
    ).toBe(true)
    expect(wire.length).toBeGreaterThanOrEqual(2)
  }
})
