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
 * Editors and drag interactions through the native backend: a rich-text
 * document edited in place and saved, and a board item dragged into another
 * column. Each fixture reacts only to what the real editing and pointer
 * pipelines produce — a contenteditable that re-renders from its own model on
 * `input`, a drop that moves a node — so a pass proves the effect reached the
 * page, and each scenario verifies the resulting state rather than the click.
 */

const executedNatively = (outcome: AgentScenarioOutcome, action: string) => {
  const executed = outcome.phases.filter(
    (line) => line.phase === "executed" && line.action === action
  )
  return executed.length > 0 && executed.every((line) => line.backend === "cdp")
}

/**
 * A controlled rich-text editor of the kind a framework renders: it keeps the
 * document in its own model string and rebuilds the editor's DOM from that
 * model on every `input`, restoring the caret by character offset. A change
 * written into the DOM behind its back would be discarded on the next
 * keystroke, so a passing edit proves the agent went through the editing
 * pipeline (native `insertText`), not a raw DOM write. Save snapshots the
 * model into a status line only when clicked.
 */
const documentPage = `<!doctype html><title>Agent editor</title><main>
<h1>Report</h1>
<div id="doc" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Report body"></div>
<button id="save" type="button">Save</button>
<p id="status">Saved: none</p>
<script>
  const doc = document.getElementById('doc')
  let model = 'The quick brown fax jumps.'
  const caretOffset = () => {
    const selection = getSelection()
    if (!selection || selection.rangeCount === 0) return model.length
    const range = selection.getRangeAt(0)
    const pre = range.cloneRange()
    pre.selectNodeContents(doc)
    pre.setEnd(range.endContainer, range.endOffset)
    return pre.toString().length
  }
  const render = (offset) => {
    doc.innerHTML = ''
    const paragraph = document.createElement('p')
    const text = document.createTextNode(model)
    paragraph.append(text)
    doc.append(paragraph)
    const range = document.createRange()
    range.setStart(text, Math.min(offset, model.length))
    range.collapse(true)
    const selection = getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }
  render(0)
  doc.addEventListener('input', () => {
    const offset = caretOffset()
    model = doc.textContent.replace(/\\s+/g, ' ')
    render(offset)
  })
  document.getElementById('save').addEventListener('click', () => {
    document.getElementById('status').textContent = 'Saved: ' + model
    fetch('/effect')
  })
</script></main>`

runAgentScenario({
  name: "rich text editing",
  goal: "Fix the typo 'fax' to 'fox' in the report, then save it.",
  status: "completed",
  approvalScope: "run_origin",
  html: () => documentPage,
  decide(observation: AgentFixtureObservation) {
    if (observation.text.includes("Saved: The quick brown fox jumps."))
      return { type: "complete", summary: "saved fox" }
    const editor = agentFixtureElement(
      observation,
      (element) => element.type === "contenteditable"
    )
    if (editor?.value?.includes("fax")) {
      return { type: "replace_text", ref: editor.ref, find: "fax", text: "fox" }
    }
    return {
      type: "click",
      ref: agentFixtureElement(
        observation,
        (element) => element.name === "Save"
      )?.ref
    }
  },
  async verify(outcome) {
    await expect(
      outcome.page.getByText("Saved: The quick brown fox jumps.")
    ).toBeVisible()
    await expect(outcome.page.locator("#doc")).toHaveText(
      "The quick brown fox jumps."
    )
    expect(outcome.snapshot?.run?.result).toContain("saved fox")
    expect(
      outcome.snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual(["replace_text", "click"])
    expect(executedNatively(outcome, "replace_text")).toBe(true)
    await expect.poll(outcome.effects).toBe(1)
  }
})

/**
 * A two-column board whose cards are HTML5-draggable and whose columns accept
 * a drop by cancelling `dragover`; a dropped card is moved in the DOM and its
 * new column recorded. Only a real drag — the debugger's, or a user's — makes
 * the browser fire `dragstart` and deliver the drop, so a moved card proves
 * the pointer gesture reached the page.
 */
const boardPage = `<!doctype html><title>Agent board</title>
<style>
  main { display: flex; gap: 24px; align-items: flex-start; padding: 16px; }
  ul { list-style: none; margin: 0; padding: 12px; width: 200px; min-height: 160px; border: 1px solid #ccc; }
  li { padding: 12px; margin: 4px 0; border: 1px solid #999; background: #eee; cursor: grab; }
</style>
<main>
<ul id="todo" role="list" aria-label="To do">
  <li id="task" role="listitem" draggable="true">Ship release</li>
</ul>
<ul id="done" role="list" aria-label="Done"></ul>
</main>
<p id="status">In: To do</p>
<script>
  const task = document.getElementById("task")
  task.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData("text/plain", "task")
    event.dataTransfer.effectAllowed = 'move'
  })
  const done = document.getElementById('done')
  done.addEventListener('dragover', (event) => event.preventDefault())
  done.addEventListener('drop', (event) => {
    event.preventDefault()
    done.append(task)
    document.getElementById('status').textContent = 'In: Done'
    fetch('/effect')
  })
</script>`

runAgentScenario({
  name: "board item move",
  goal: "Move the 'Ship release' card into the Done column.",
  status: "completed",
  approvalScope: "run_origin",
  html: () => boardPage,
  decide(observation: AgentFixtureObservation) {
    if (observation.text.includes("In: Done"))
      return { type: "complete", summary: "moved to Done" }
    const card = agentFixtureElement(
      observation,
      (element) => element.draggable === true
    )
    const done = agentFixtureElement(
      observation,
      (element) => element.name === "Done"
    )
    if (!card || !done) return { type: "fail", reason: "board not observed" }
    return { type: "drag", ref: card.ref, to: done.ref }
  },
  async verify(outcome) {
    await expect(outcome.page.getByText("In: Done")).toBeVisible()
    await expect(outcome.page.locator("#done #task")).toHaveCount(1)
    expect(outcome.snapshot?.run?.result).toContain("moved to Done")
    expect(
      outcome.snapshot?.steps
        .filter((step) => step.status === "verified")
        .map((step) => step.command?.type)
    ).toEqual(["drag"])
    expect(executedNatively(outcome, "drag")).toBe(true)
    await expect.poll(outcome.effects).toBe(1)
  }
})
