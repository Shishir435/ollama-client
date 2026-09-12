import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

runAgentScenario({
  name: "useful-composer-placeholder",
  hosted: true,
  goal: "In the Ask assistant composer, type hello. Do not send it.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Compose</title><style>p[data-placeholder]::before{content:attr(data-placeholder)}button{display:inline-block}</style><nav>${"<button>Unrelated navigation control</button>".repeat(150)}</nav><main><div contenteditable="true" role="textbox" aria-label="Chat with assistant"><p data-placeholder="Ask assistant"><br></p></div></main>`,
  decide(observation) {
    const editor = agentFixtureElement(
      observation,
      (element) => element.type === "contenteditable"
    )
    if (!editor) return { type: "find", query: "Ask assistant" }
    return editor.value === "hello"
      ? {
          type: "complete",
          summary: "Drafted hello without sending.",
          evidence: "hello"
        }
      : { type: "clear_and_type", ref: editor.ref, text: "hello" }
  },
  async verify({ page }) {
    await expect(page.locator("[contenteditable]")).toHaveText("hello")
  }
})

/** These workflows exercise real renderer behavior and independently check the result. */
const original = `${"An ordinary document paragraph. ".repeat(60)}unique typo`
runAgentScenario({
  name: "useful-long-edit",
  hosted: true,
  goal: "In the document, replace 'unique typo' with 'correct phrase', preserving everything else.",
  status: "completed",
  approvalScope: "run_origin",
  html: () =>
    `<!doctype html><title>Document</title><main><div contenteditable="true" aria-label="Document">${original}</div></main>`,
  decide(observation) {
    const editor = agentFixtureElement(
      observation,
      (element) => element.type === "contenteditable"
    )
    return editor?.value?.includes("correct phrase")
      ? {
          type: "complete",
          summary: "Corrected the document.",
          evidence: "correct phrase"
        }
      : {
          type: "replace_text",
          ref: editor?.ref,
          find: "unique typo",
          text: "correct phrase"
        }
  },
  async verify({ page }) {
    await expect(page.locator("[contenteditable]")).toHaveText(
      original.replace("unique typo", "correct phrase")
    )
  }
})

runAgentScenario({
  name: "useful-pane-scroll",
  hosted: true,
  goal: "Scroll the left Tasks pane and click Finish at its bottom.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Tasks</title><main><div aria-label="Tasks" role="region" style="width:180px;height:180px;overflow:auto"><div style="height:900px">Tasks</div><button onclick="document.getElementById('status').textContent='Task finished'">Finish</button></div><p id="status">Pending</p></main>`,
  decide(observation) {
    if (observation.text.includes("Task finished"))
      return {
        type: "complete",
        summary: "Finished.",
        evidence: "Task finished"
      }
    const finish = agentFixtureElement(
      observation,
      (element) => element.name === "Finish" && !element.hidden
    )
    if (finish) return { type: "click", ref: finish.ref }
    const pane = agentFixtureElement(observation, (element) =>
      Boolean(element.scroll)
    )
    return {
      type: "scroll",
      ref: pane?.ref,
      container: true,
      direction: "down",
      amount: 1000
    }
  },
  async verify({ page }) {
    await expect(page.locator("#status")).toHaveText("Task finished")
  }
})

runAgentScenario({
  name: "useful-paginated-reading",
  hosted: true,
  goal: "Read the document through to its end and report the final reference code.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Long document</title><main><p>${"ordinary text ".repeat(3000)}Final reference code: ZEBRA-742.</p></main>`,
  decide(observation) {
    if (observation.textPage?.text.includes("ZEBRA-742"))
      return { type: "complete", summary: "Final reference code: ZEBRA-742." }
    return {
      type: "extract_text",
      offset: observation.textPage?.nextOffset ?? 0
    }
  },
  async verify({ page, snapshot }) {
    await expect(page.locator("main")).toContainText("ZEBRA-742")
    expect(snapshot?.run?.result).toContain("ZEBRA-742")
  }
})

runAgentScenario({
  name: "useful-clarification",
  hosted: true,
  goal: "Select my preferred account. Ask me which account to use before selecting.",
  answer: "Use Blue.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Accounts</title><main><button onclick="document.getElementById('status').textContent='Blue selected'">Blue</button><button onclick="document.getElementById('status').textContent='Red selected'">Red</button><p id="status">No selection</p></main>`,
  decide(observation, context) {
    if (observation.text.includes("Blue selected"))
      return {
        type: "complete",
        summary: "Selected Blue.",
        evidence: "Blue selected"
      }
    if (!context.userAnswers?.some((answer) => answer.text.includes("Blue")))
      return { type: "ask_user", question: "Which account?" }
    return {
      type: "click",
      ref: agentFixtureElement(
        observation,
        (element) => element.name === "Blue"
      )?.ref
    }
  },
  async verify({ page }) {
    await expect(page.locator("#status")).toHaveText("Blue selected")
  }
})

runAgentScenario({
  name: "useful-delayed-completion",
  hosted: true,
  goal: "Save the document and wait until all changes are saved.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Save document</title><main><p id="status">Unsaved</p><button onclick="this.disabled=true;document.getElementById('status').textContent='Saving';setTimeout(()=>document.getElementById('status').textContent='All changes saved',1200)">Save</button></main>`,
  decide(observation) {
    if (observation.text.includes("Unsaved"))
      return {
        type: "click",
        ref: agentFixtureElement(
          observation,
          (element) => element.name === "Save"
        )?.ref
      }
    return {
      type: "complete",
      summary: "Saved document.",
      evidence: "All changes saved"
    }
  },
  async verify({ page, wire }) {
    await expect(page.locator("#status")).toHaveText("All changes saved")
    expect(
      wire.filter(
        (call) => (call.decision as { type?: string })?.type === "click"
      )
    ).toHaveLength(process.env.AGENT_HOSTED_MODEL ? 0 : 1)
  }
})

runAgentScenario({
  name: "useful-native-dialog",
  hosted: true,
  vision: true,
  goal: "Click Continue and accept its confirmation dialog.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Confirmation</title><main><button onclick="if(confirm('Continue with the task?'))document.getElementById('status').textContent='Confirmed task'">Continue</button><p id="status">Not started</p></main>`,
  decide(observation) {
    const dialog = observation.dialogs?.[0]
    if (dialog)
      return { type: "handle_dialog", dialogId: dialog.id, accept: true }
    if (observation.text.includes("Confirmed task"))
      return {
        type: "complete",
        summary: "Confirmed.",
        evidence: "Confirmed task"
      }
    return {
      type: "click",
      ref: agentFixtureElement(
        observation,
        (element) => element.name === "Continue"
      )?.ref
    }
  },
  async verify({ page }) {
    await expect(page.locator("#status")).toHaveText("Confirmed task")
  }
})
