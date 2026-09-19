import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import { observations, runAgentScenario } from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * Six questions in one walk, and the walk covers the whole page.
 *
 * An empty group is an answer — the model is told the page carries no control
 * matching that question — so a lookup that only ever read the root document
 * would state as fact that a control inside an authorized iframe is not
 * there. That is the failure this gate exists for: the control the task needs
 * lives in the frame, and nothing but the frame's own answer can reach it.
 */
const HOST_PAGE = `<!doctype html>
<title>Newsletter</title>
<main>
  <h1>Newsletter</h1>
  <p>Sign-up is handled by the widget below.</p>
  <iframe src="/widget" title="Sign-up widget" width="400" height="200"></iframe>
</main>`

const WIDGET_PAGE = `<!doctype html>
<title>Widget</title>
<main>
  <button id="subscribe" type="button" onclick="document.getElementById('state').textContent = 'Joined the list'">Subscribe to the newsletter</button>
  <p id="state">Nobody has joined</p>
</main>`

runAgentScenario({
  name: "extract-reaches-an-authorized-frame",
  goal: "Subscribe to the newsletter.",
  status: "completed",
  timeoutMs: 120_000,
  html: (path: string) =>
    path.startsWith("/widget") ? WIDGET_PAGE : HOST_PAGE,
  allowRoutineActions: true,
  approvalScope: "run_origin",
  plan: [{ text: "the newsletter sign-up is confirmed", kind: "change" }],
  decide: (observation: AgentFixtureObservation) => {
    if (observation.text.includes("Joined the list")) {
      return {
        type: "complete",
        summary: "Subscribed through the widget.",
        outcomes: [{ id: "r1", met: true, evidence: "Joined the list" }]
      }
    }
    if (!observation.lookup) {
      return { type: "extract", queries: ["subscribe", "unsubscribe"] }
    }
    const ref = observation.lookup[0]?.refs[0]
    return ref ? { type: "click", ref } : { type: "read" }
  },
  verify: async ({ page, snapshot, wire }) => {
    const answered = observations(wire).find((entry) => entry.lookup)
    /**
     * The match is the frame's, and says so: a ref prefixed `f` belongs to a
     * child document, which is what lets one group hold matches from several
     * without the model having to tell them apart itself.
     */
    expect(answered?.lookup?.[0]?.query).toBe("subscribe")
    expect(answered?.lookup?.[0]?.refs[0]).toMatch(/^f\d+e/)
    /** The unasked-for question is answered too, and its answer is nothing. */
    expect(answered?.lookup?.[1]).toMatchObject({
      query: "unsubscribe",
      refs: []
    })
    await expect(page.frameLocator("iframe").locator("#state")).toHaveText(
      "Joined the list"
    )
    expect(snapshot?.run?.status).toBe("completed")
  }
})
