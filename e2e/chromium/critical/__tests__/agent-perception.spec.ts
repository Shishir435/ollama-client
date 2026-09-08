import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentConfirmingButton,
  agentFixtureElement,
  firstObservation,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const clickContinue = (observation: AgentFixtureObservation) =>
  observation.visibleText.includes("Status: Active")
    ? { type: "complete", summary: "Active" }
    : {
        type: "click",
        ref: agentFixtureElement(
          observation,
          (element) => element.name === "Continue"
        )?.ref
      }

/**
 * A role-bearing SVG is an ordinary decoration, and `[role]` admits it as an
 * observation candidate. Deriving its fields from HTML properties it does not
 * have produced `undefined` where the contract requires a boolean, and the
 * whole snapshot was rejected — one icon made the page unobservable.
 */
runAgentScenario({
  name: "svg",
  goal: "Click Continue and report the status.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Agent svg</title><main><svg role="img" aria-label="Brand" width="24" height="24"><rect width="24" height="24"></rect></svg><a role="link" href="/help">Help</a>${agentConfirmingButton()}</main>`,
  decide: clickContinue,
  async verify({ page, snapshot, wire }) {
    await expect(page.getByText("Status: Active")).toBeVisible()
    expect(snapshot?.run?.result).toContain("Active")
    const observed = firstObservation(wire)
    const svg = observed.elements.find((element) => element.tag === "svg")
    expect(svg).toMatchObject({ role: "img", name: "Brand" })
    for (const element of observed.elements) {
      expect(typeof element.editable).toBe("boolean")
      expect(typeof element.enabled).toBe("boolean")
      expect(typeof element.visible).toBe("boolean")
    }
  }
})

/**
 * A page can hold far more interactive elements than the observation cap, and
 * a document-order cap let hidden ones consume the whole budget: the run then
 * had nothing to act on even though the page rendered one obvious control.
 */
runAgentScenario({
  name: "starved",
  goal: "Click Continue and report the status.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Agent starved</title><main>${Array.from(
      { length: 2_100 },
      (_value, index) =>
        `<input type="hidden" name="token-${index}" value="${index}">`
    ).join("")}${agentConfirmingButton()}</main>`,
  decide: clickContinue,
  async verify({ page, snapshot, wire }) {
    await expect(page.getByText("Status: Active")).toBeVisible()
    expect(snapshot?.run?.result).toContain("Active")
    const observed = firstObservation(wire)
    expect(observed.elements.length).toBeLessThanOrEqual(2_000)
    expect(
      observed.elements
        .filter((element) => element.visible)
        .map((element) => element.name)
    ).toEqual(["Continue"])
  }
})
