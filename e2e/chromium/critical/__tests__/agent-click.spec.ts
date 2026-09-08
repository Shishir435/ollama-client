import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentConfirmingButton,
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const page = (button: string) =>
  `<!doctype html><title>Agent click</title><main>${button}</main>`

/** Activation with no observable consequence: the run must not claim one. */
const silentButton =
  '<button type="button" onclick="fetch(\'/effect\');">Continue</button>'

const clickContinue = (observation: AgentFixtureObservation) =>
  observation.text.includes("Status: Active")
    ? { type: "complete", summary: "Active" }
    : {
        type: "click",
        ref: agentFixtureElement(
          observation,
          (element) => element.name === "Continue"
        )?.ref
      }

runAgentScenario({
  name: "click",
  goal: "Click Continue and report the status.",
  status: "completed",
  html: () => page(agentConfirmingButton()),
  decide: clickContinue,
  async verify({ page: fixture, snapshot, wire, effects }) {
    await expect(fixture.getByText("Status: Active")).toBeVisible()
    expect(snapshot?.run?.result).toContain("Active")
    expect(snapshot?.run?.observationCount).toBeGreaterThanOrEqual(2)
    expect(
      snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual(["click"])
    await expect.poll(effects).toBe(1)
    expect(wire.length).toBeGreaterThanOrEqual(2)
  }
})

runAgentScenario({
  name: "stale",
  goal: "Click Continue and report the status.",
  status: "completed",
  html: () => page(agentConfirmingButton()),
  async decide(observation, { step, page: fixture }) {
    const decision = clickContinue(observation)
    // The observed element is swapped after the decision names it, so the
    // first attempt has to be refused rather than applied to its double.
    if (step === 1)
      await fixture.evaluate(() => {
        const button = document.querySelector("button")
        button?.replaceWith(button.cloneNode(true))
      })
    return decision
  },
  async verify({ page: fixture, snapshot, wire, effects }) {
    await expect(fixture.getByText("Status: Active")).toBeVisible()
    expect(snapshot?.run?.result).toContain("Active")
    expect(snapshot?.run?.observationCount).toBeGreaterThanOrEqual(3)
    expect(
      snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual(["click"])
    expect(
      snapshot?.steps.some(
        (step) => step.verification?.evidence.kind === "stale_target"
      )
    ).toBe(true)
    await expect.poll(effects).toBe(1)
    expect(wire.length).toBeGreaterThanOrEqual(3)
  }
})

runAgentScenario({
  name: "uncertain",
  goal: "Click Continue and report the status.",
  status: "paused",
  html: () => page(silentButton),
  decide: clickContinue,
  async verify({ snapshot, wire, effects }) {
    expect(snapshot?.run?.pauseReason).toBe("unresolved_effect")
    await expect.poll(effects).toBe(1)
    expect(wire).toHaveLength(1)
  }
})
