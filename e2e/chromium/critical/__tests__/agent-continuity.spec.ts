import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentConfirmingButton,
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const readPrompt = (request: unknown) =>
  JSON.parse(
    String(
      (request as { messages: { content: string }[] }).messages.at(-1)?.content
    )
  )

/**
 * Every decision used to be made from the current page alone, so a run that
 * had just clicked saw a changed page and no record of changing it. This
 * asserts the second request can see the first action and its outcome.
 */
runAgentScenario({
  name: "continuity",
  goal: "Click Continue and report the status.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Agent continuity</title><main>${agentConfirmingButton()}</main>`,
  decide: (observation: AgentFixtureObservation) =>
    observation.text.includes("Status: Active")
      ? { type: "complete", summary: "Active" }
      : {
          type: "click",
          ref: agentFixtureElement(
            observation,
            (element) => element.name === "Continue"
          )?.ref,
          finding: "Continue was the only control on the page."
        },
  async verify({ page, snapshot, wire }) {
    await expect(page.getByText("Status: Active")).toBeVisible()
    expect(snapshot?.run?.result).toContain("Active")

    const first = readPrompt(wire[0]?.request)
    expect(first).not.toHaveProperty("history")

    const second = readPrompt(wire[1]?.request)
    expect(second.history).toHaveLength(1)
    expect(second.history[0]).toMatchObject({
      step: 1,
      action: "click",
      outcome: "confirmed",
      finding: "Continue was the only control on the page."
    })
    expect(second.history[0].target).toMatchObject({ tag: "button" })
    expect(second.previousStepOutcome).toBe("confirmed")

    // The receipt keeps what the ref cannot describe once the page moved on.
    const verified = snapshot?.steps.find((step) => step.status === "verified")
    expect(verified).toMatchObject({
      target: { tag: "button", name: "Continue" }
    })
    expect(verified?.sourceUrl).toContain("127.0.0.1")
    // A finding is written once, on the receipt for the decision that made
    // it; history merges a step's receipts, so the model still sees it.
    expect(
      snapshot?.steps.find((step) => step.status === "planned")?.finding
    ).toBe("Continue was the only control on the page.")
  }
})

/**
 * Two facts on two pages: the answer needs both, and the second page cannot
 * show the first. Without a record the run can only report what it can
 * currently see.
 */
runAgentScenario({
  name: "compare",
  goal: "Read the price on both pages and say which is cheaper.",
  status: "completed",
  html: (path) => {
    if (path.startsWith("/second"))
      return "<!doctype html><title>Second</title><main><h1>Beta</h1><p>Price: 12</p></main>"
    return '<!doctype html><title>First</title><main><h1>Alpha</h1><p>Price: 30</p><a href="/second">Beta</a></main>'
  },
  decide(observation: AgentFixtureObservation, { step }) {
    if (step === 1)
      return {
        type: "read",
        finding: "Alpha costs 30 on the first page."
      }
    if (step === 2)
      return {
        type: "click",
        ref: agentFixtureElement(
          observation,
          (element) => element.name === "Beta"
        )?.ref
      }
    if (step === 3)
      return {
        type: "read",
        finding: "Beta costs 12 on the second page."
      }
    return { type: "complete", summary: "Beta is cheaper: 12 against 30." }
  },
  async verify({ snapshot, wire }) {
    expect(snapshot?.run?.result).toContain("Beta is cheaper")

    const last = readPrompt(wire.at(-1)?.request)
    const findings = (last.history as { finding?: string }[])
      .map((entry) => entry.finding)
      .filter(Boolean)
    expect(findings).toEqual([
      "Alpha costs 30 on the first page.",
      "Beta costs 12 on the second page."
    ])
    // Both pages are named, though only one of them is on screen.
    const urls = new Set(
      (last.history as { url?: string }[])
        .map((entry) => entry.url)
        .filter(Boolean)
    )
    expect([...urls].some((url) => String(url).includes("/second"))).toBe(true)
    expect(urls.size).toBeGreaterThan(1)
  }
})
