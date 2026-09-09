import type {
  AgentFixtureObservation,
  AgentScenarioOutcome
} from "../../fixtures/agent-scenario"
import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * Native input through the attached debugger: real pointer and key events a
 * page cannot tell from a user's. Each fixture only reacts to what a synthetic
 * DOM event cannot produce — a `mousedown` before a `click`, a `keydown` for
 * every character, an arrow key on a focused listbox — so a pass proves the
 * events came from the browser's input pipeline.
 */

const executedNatively = (outcome: AgentScenarioOutcome, action: string) =>
  outcome.phases.some(
    (line) =>
      line.phase === "executed" &&
      line.backend === "cdp" &&
      outcome.phases.some(
        (earlier) => earlier.phase === "executing" && earlier.action === action
      )
  )

/**
 * A listbox-backed dropdown built the way component libraries build them: a
 * `combobox` button that opens on `mousedown` (not `click`), options that
 * commit on `mouseup`, and a status line that reflects the committed value.
 */
const dropdownPage = `<!doctype html><title>Agent dropdown</title><main>
<h1>Region</h1>
<button id="opener" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-label="Region">Choose region</button>
<ul id="list" role="listbox" aria-label="Regions" hidden>
  <li role="option" tabindex="-1" data-value="north">North</li>
  <li role="option" tabindex="-1" data-value="south">South</li>
</ul>
<p id="status">Status: unset</p>
<script>
  const opener = document.getElementById('opener')
  const list = document.getElementById('list')
  const status = document.getElementById('status')
  let armed = false
  opener.addEventListener('mousedown', () => { armed = true })
  opener.addEventListener('click', () => {
    if (!armed) return
    armed = false
    list.hidden = false
    opener.setAttribute('aria-expanded', 'true')
  })
  for (const option of list.querySelectorAll('[role=option]')) {
    let pressed = false
    option.addEventListener('mousedown', () => { pressed = true })
    option.addEventListener('mouseup', () => {
      if (!pressed) return
      pressed = false
      status.textContent = 'Status: ' + option.dataset.value
      list.hidden = true
      opener.setAttribute('aria-expanded', 'false')
      fetch('/effect')
    })
  }
</script></main>`

runAgentScenario({
  name: "native dropdown",
  goal: "Choose the South region and report the status.",
  status: "completed",
  approvalScope: "run_origin",
  html: () => dropdownPage,
  decide(observation: AgentFixtureObservation) {
    if (observation.text.includes("Status: south"))
      return { type: "complete", summary: "south" }
    const option = agentFixtureElement(
      observation,
      (element) => element.role === "option" && element.name === "South"
    )
    if (option) return { type: "click", ref: option.ref }
    return {
      type: "click",
      ref: agentFixtureElement(
        observation,
        (element) => element.role === "combobox"
      )?.ref
    }
  },
  async verify(outcome) {
    await expect(outcome.page.getByText("Status: south")).toBeVisible()
    expect(outcome.snapshot?.run?.result).toContain("south")
    expect(
      outcome.snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual(["click", "click"])
    expect(executedNatively(outcome, "click")).toBe(true)
    await expect.poll(outcome.effects).toBe(1)
  }
})

/**
 * A controlled field of the kind frameworks render: its displayed value is
 * re-rendered from state on every `input` event, and the page also counts the
 * character `keydown` events it saw, chords excluded. A value set from script
 * produces no keydowns, so the count is what tells typed text from assigned
 * text.
 */
const controlledPage = `<!doctype html><title>Agent controlled input</title><main>
<h1>Profile</h1>
<label for="name">Name</label>
<input id="name" autocomplete="off">
<p id="status">Keys: 0</p>
<p id="value">Value: </p>
<script>
  const input = document.getElementById('name')
  let state = ''
  let keys = 0
  input.addEventListener('keydown', (event) => {
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) keys += 1
    document.getElementById('status').textContent = 'Keys: ' + keys
  })
  input.addEventListener('input', () => {
    state = input.value
    input.value = state
    document.getElementById('value').textContent = 'Value: ' + state
  })
</script></main>`

runAgentScenario({
  name: "native typing",
  goal: "Enter Alice as the name and report how many keys the page counted.",
  status: "completed",
  approvalScope: "run_origin",
  html: () => controlledPage,
  decide(observation: AgentFixtureObservation) {
    if (observation.text.includes("Value: Alice"))
      return {
        type: "complete",
        summary: observation.text.match(/Keys: \d+/)?.[0] ?? ""
      }
    const field = agentFixtureElement(
      observation,
      (element) => element.tag === "input"
    )
    return { type: "clear_and_type", ref: field?.ref, text: "Alice" }
  },
  async verify(outcome) {
    await expect(outcome.page.getByText("Value: Alice")).toBeVisible()
    await expect(outcome.page.getByText("Keys: 5")).toBeVisible()
    expect(outcome.snapshot?.run?.result).toContain("Keys: 5")
    expect(executedNatively(outcome, "clear_and_type")).toBe(true)
  }
})

/**
 * Keyboard navigation inside a focused listbox: ArrowDown moves the active
 * option and Enter commits it. Only a key event the browser itself delivers
 * reaches the focused element with default handling intact.
 */
const listboxPage = `<!doctype html><title>Agent listbox</title><main>
<h1>Size</h1>
<ul id="sizes" role="listbox" tabindex="0" aria-label="Size" aria-activedescendant="s1">
  <li id="s1" role="option" aria-selected="true">Small</li>
  <li id="s2" role="option">Medium</li>
  <li id="s3" role="option">Large</li>
</ul>
<p id="active">Active: Small</p>
<p id="status">Status: none</p>
<script>
  const list = document.getElementById('sizes')
  const options = [...list.querySelectorAll('[role=option]')]
  let active = 0
  const render = () => {
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === active)))
    list.setAttribute('aria-activedescendant', options[active].id)
    document.getElementById('active').textContent = 'Active: ' + options[active].textContent
  }
  list.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { active = Math.min(active + 1, options.length - 1); render(); event.preventDefault() }
    if (event.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); event.preventDefault() }
    if (event.key === 'Enter') {
      document.getElementById('status').textContent = 'Status: ' + options[active].textContent
      fetch('/effect')
    }
  })
</script></main>`

runAgentScenario({
  name: "native keyboard navigation",
  goal: "Select the Large size with the keyboard and report the status.",
  status: "completed",
  approvalScope: "run_origin",
  html: () => listboxPage,
  decide(observation: AgentFixtureObservation) {
    if (observation.text.includes("Status: Large"))
      return { type: "complete", summary: "Large" }
    const list = agentFixtureElement(
      observation,
      (element) => element.role === "listbox"
    )
    if (!list) return { type: "fail", reason: "no listbox" }
    if (!list.focused) return { type: "click", ref: list.ref }
    return {
      type: "press_key",
      ref: list.ref,
      key: observation.text.includes("Active: Large") ? "Enter" : "ArrowDown"
    }
  },
  async verify(outcome) {
    await expect(outcome.page.getByText("Status: Large")).toBeVisible()
    expect(outcome.snapshot?.run?.result).toContain("Large")
    expect(executedNatively(outcome, "press_key")).toBe(true)
    await expect.poll(outcome.effects).toBe(1)
  }
})
