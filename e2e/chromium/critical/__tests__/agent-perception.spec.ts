import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentConfirmingButton,
  agentFixtureElement,
  firstObservation,
  observations,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const clickContinue = (observation: AgentFixtureObservation) =>
  observation.text.includes("Status: Active")
    ? { type: "complete", summary: "Active", evidence: "Status: Active" }
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
    // Field-level derivation is asserted where it happens, in the builder's
    // own tests: the wire is projected now, so a default is absent rather
    // than present and false.
    expect(svg).not.toHaveProperty("editable")
    expect(svg).not.toHaveProperty("disabled")
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
        .filter((element) => !element.hidden)
        .map((element) => element.name)
    ).toEqual(["Continue"])
  }
})

/**
 * A model that keeps asking for a region the page does not have.
 *
 * This ran twenty-one of its twenty-five observations before the budget
 * stopped it, with a no-progress guard set to three standing right there: the
 * guard wanted an identical page and a live application changes between every
 * pair of observations. Two things are asserted, because either alone leaves
 * the loop half-open — the observation tells the model its request missed and
 * names the regions that exist, and the run is stopped in a handful of steps
 * when the model asks anyway.
 */
runAgentScenario({
  name: "unmatched-region",
  goal: "Find the weather control.",
  status: "failed",
  html: () =>
    `<!doctype html><title>Agent unmatched region</title><nav aria-label="Primary"><a href="/help">Help</a></nav><main><form aria-label="Search"><input name="q" aria-label="Query"><button type="submit">Go</button></form></main>`,
  /** Every step, and the page never changes because nothing here mutates it. */
  decide: () => ({ type: "inspect", target: "sidebar" }),
  async verify({ snapshot, wire }) {
    expect(snapshot?.run?.error?.code).toBe("budget_exhausted")
    /** Four identical decisions, not twenty-five. */
    expect(snapshot?.run?.observationCount).toBe(4)

    const answered = observations(wire).find((one) => one.unmatched)
    expect(answered?.unmatched?.region).toBe("sidebar")
    expect(answered?.unmatched?.regions).toContain('form "Search"')
    expect(answered?.unmatched?.regions).toContain('nav "Primary"')
  }
})
