import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import { runAgentScenario } from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * Visual grounding through a scripted vision model. The page is one canvas
 * filling the viewport that records where it was clicked; no element ref can
 * name a region of it, so the only way to hit the left half is a point in the
 * screenshot. The scripted model cannot see the picture, but it knows the
 * canvas fills the frame, so a quarter of the way across is the left half.
 */
const canvasPage = `<!doctype html><title>Agent canvas</title>
<style>html,body{margin:0;height:100%}canvas{position:fixed;inset:0;width:100vw;height:100vh;display:block}</style>
<main>
<canvas id="board" aria-label="Board"></canvas>
<p id="status" style="position:fixed;bottom:0;left:0;margin:0;background:#fff">Status: waiting</p>
<script>
  const canvas = document.getElementById('board')
  const status = document.getElementById('status')
  canvas.addEventListener('click', (event) => {
    const half = event.clientX < window.innerWidth / 2 ? 'left' : 'right'
    status.textContent = 'Status: ' + half
    fetch('/effect')
  })
</script></main>`

runAgentScenario({
  name: "visual click",
  goal: "Click the left half of the board and report the status.",
  status: "completed",
  approvalScope: "run_origin",
  vision: true,
  html: () => canvasPage,
  decide(observation: AgentFixtureObservation, context) {
    if (observation.text.includes("Status: left"))
      return { type: "complete", summary: "left" }
    /* A vision model is shown the picture and offered the visual commands. */
    expect(context.images).toBe(1)
    expect(context.actions).toContain("click_point")
    expect(context.screenshot).toBeDefined()
    const width = context.screenshot?.width ?? 0
    const height = context.screenshot?.height ?? 0
    return {
      type: "click_point",
      x: Math.round(width / 4),
      y: Math.round(height / 2)
    }
  },
  async verify({ page, snapshot, wire, effects, phases }) {
    await expect(page.getByText("Status: left")).toBeVisible()
    expect(snapshot?.run?.result).toContain("left")
    expect(
      snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual(["click_point"])
    await expect.poll(effects).toBe(1)
    /* The picture rode with the request and was taken with the observation. */
    const request = wire[0]?.request as { messages: { images?: unknown[] }[] }
    expect(request.messages.at(-1)?.images).toHaveLength(1)
    expect(
      phases.some(
        (line) => line.phase === "screenshot" && line.captured === true
      )
    ).toBe(true)
    /* Nothing durable carries image bytes. */
    expect(JSON.stringify(snapshot)).not.toContain("/9j/")
  }
})

runAgentScenario({
  name: "text-only model",
  goal: "Report the status shown on the page.",
  status: "completed",
  html: () => canvasPage,
  decide(observation: AgentFixtureObservation, context) {
    /* No picture is taken for a model that cannot read one, and no visual command is offered. */
    expect(context.images).toBe(0)
    expect(context.actions).not.toContain("click_point")
    expect(context.actions).not.toContain("zoom")
    expect(context.screenshot).toBeUndefined()
    return {
      type: "complete",
      summary: observation.text.match(/Status: \w+/)?.[0] ?? ""
    }
  },
  async verify({ snapshot, phases }) {
    expect(snapshot?.run?.result).toContain("Status: waiting")
    expect(phases.some((line) => line.phase === "screenshot")).toBe(false)
  }
})
