import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentFixtureElement,
  firstObservation,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * A confirmation dialog puts two buttons on the page with the same job and a
 * different owner. A flat element list gave a decision nothing to tell them
 * apart with, so the run acted on the opener again and the dialog stayed up.
 */
runAgentScenario({
  name: "modal",
  goal: "Delete the item, confirming when asked.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Agent modal</title><main><h1>Items</h1><button onclick="document.querySelector('#confirm').hidden=false;this.disabled=true">Delete</button><div id="confirm" role="dialog" aria-label="Confirm delete" hidden><p>Delete this item?</p><button onclick="document.querySelector('main').insertAdjacentHTML('beforeend','<p>Status: Active</p>');this.closest('[role=dialog]').hidden=true">Delete</button><button>Cancel</button></div></main>`,
  decide(observation: AgentFixtureObservation) {
    if (observation.text.includes("Status: Active"))
      return {
        type: "complete",
        summary: "Active",
        evidence: "Status: Active"
      }
    const inDialog = agentFixtureElement(
      observation,
      (element) =>
        element.name === "Delete" &&
        Boolean(element.group?.startsWith("dialog")) &&
        !element.disabled
    )
    const opener = agentFixtureElement(
      observation,
      (element) =>
        element.name === "Delete" && !element.group?.startsWith("dialog")
    )
    return { type: "click", ref: (inDialog ?? opener)?.ref }
  },
  async verify({ page, snapshot, wire }) {
    await expect(page.getByText("Status: Active")).toBeVisible()
    expect(snapshot?.run?.result).toContain("Active")

    // The opener is not clicked twice: the second decision can see that the
    // dialog owns its own Delete.
    const verified = snapshot?.steps.filter(
      (step) => step.status === "verified"
    )
    expect(verified).toHaveLength(2)

    expect(firstObservation(wire).modals ?? []).toEqual([])
    const afterOpen = JSON.parse(
      String(
        (wire[1]?.request as { messages: { content: string }[] }).messages.at(
          -1
        )?.content
      )
    ).observation
    expect(afterOpen.modals).toEqual([
      { id: "dialog1", kind: "dialog", label: "Confirm delete" }
    ])
    expect(
      afterOpen.elements.filter(
        (element: { group?: string }) => element.group === "dialog1"
      ).length
    ).toBeGreaterThan(1)
  }
})
