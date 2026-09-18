import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentFixtureElement,
  observations,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * The omission the scoped read exists to fix, in a real browser.
 *
 * The overview caps at 2,000 controls under a 500ms budget, so the button
 * this task needs cannot be in it — and `find` used to re-rank the overview's
 * own list, which meant the only way to look for the control was to look
 * where it had already been ruled out.
 *
 * Observations are recorded here and asserted in `verify`: a failed
 * expectation inside `decide` throws in the fixture's request handler, where
 * it surfaces as a timeout with no evidence attached.
 */
const CONTROL_COUNT = 2_100

const crowdedPage = (target: string) => `<!doctype html>
<title>Crowded</title>
<main>
  <div id="rows"></div>
  <p id="status">Nothing archived</p>
</main>
<script>
  const html = []
  for (let index = 0; index < ${CONTROL_COUNT}; index += 1) {
    html.push('<button type="button">Filler ' + index + '</button>')
  }
  html.push('<button type="button" onclick="document.getElementById(\\'status\\').textContent = \\'Archived the ledger\\'">${target}</button>')
  document.getElementById("rows").innerHTML = html.join("")
</script>`

const TARGET = "Archive the ledger"

runAgentScenario({
  name: "scoped-find-past-the-cap",
  goal: "Archive the ledger.",
  status: "completed",
  timeoutMs: 120_000,
  html: () => crowdedPage(TARGET),
  plan: [{ text: "the ledger is archived", kind: "change" }],
  /**
   * Driven off what the page says rather than a decision counter: a refused
   * completion or a settle poll shifts the counter, and the scenario then
   * answers the wrong question at the wrong moment.
   */
  decide: (observation: AgentFixtureObservation) => {
    /**
     * Read from the document, not the viewport: reaching the control meant
     * scrolling two thousand rows past the status line that reports success.
     */
    const page = `${observation.text} ${observation.documentText ?? ""}`
    if (page.includes("Archived the ledger")) {
      return {
        type: "complete",
        summary: "Archived the ledger.",
        outcomes: [{ id: "r1", met: true, evidence: "Archived the ledger" }]
      }
    }
    const archive = agentFixtureElement(
      observation,
      (element) => element.name === TARGET
    )
    if (!archive) return { type: "find", query: "archive the ledger" }
    /**
     * A control 2,400 rows down is found but not visible, and acting on
     * something off-screen is refused. Scrolling to a ref brings it into
     * view, which is the path the prompt names.
     */
    return archive.hidden
      ? { type: "scroll", ref: archive.ref, direction: "down" }
      : { type: "click", ref: archive.ref }
  },
  verify: async ({ page, snapshot, wire }) => {
    const [overview, scoped] = observations(wire)
    /** The overview genuinely cannot carry it, which is why find exists. */
    expect(overview?.elements.some((element) => element.name === TARGET)).toBe(
      false
    )
    /** The scoped answer reaches it, and says it is complete. */
    expect(scoped?.scope).toMatchObject({ kind: "query", returned: 1 })
    expect(scoped?.scope?.nextOffset).toBeUndefined()
    expect(scoped?.elements.some((element) => element.name === TARGET)).toBe(
      true
    )
    /** Found off-screen, scrolled to, then acted on. */
    expect(
      observations(wire).some((entry) =>
        entry.elements.some(
          (element) => element.name === TARGET && element.hidden !== true
        )
      )
    ).toBe(true)
    await expect(page.locator("#status")).toHaveText("Archived the ledger")
    expect(snapshot?.run?.status).toBe("completed")
  }
})

/**
 * More matches than one answer carries has to be said out loud, or a model
 * reads the first page as all of them.
 */
runAgentScenario({
  name: "scoped-find-continues",
  goal: "Count the pickable rows.",
  status: "completed",
  timeoutMs: 120_000,
  html: () =>
    `<!doctype html><title>Many</title><main>${Array.from(
      { length: 120 },
      (_unused, index) => `<button type="button">Row ${index} pick</button>`
    ).join("")}</main>`,
  plan: [{ text: "report how many rows are pickable", kind: "read" }],
  decide: (observation: AgentFixtureObservation) => {
    if (observation.scope === undefined) return { type: "find", query: "pick" }
    if (observation.scope.offset === 0 && observation.scope.nextOffset)
      return {
        type: "find",
        query: "pick",
        offset: observation.scope.nextOffset
      }
    return {
      type: "complete",
      summary: "Counted them.",
      outcomes: [{ id: "r1", met: true }]
    }
  },
  verify: async ({ snapshot, wire }) => {
    const [, first, second] = observations(wire)
    /** A bounded answer says where it stopped. */
    expect(first?.scope?.nextOffset).toBeGreaterThan(0)
    expect(first?.scope?.offset).toBe(0)
    /** The continuation is a different page, not the same one again. */
    expect(second?.scope?.offset).toBe(first?.scope?.nextOffset)
    expect(second?.elements[0]?.name).not.toBe(first?.elements[0]?.name)
    expect(snapshot?.run?.status).toBe("completed")
  }
})
