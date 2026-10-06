import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

/**
 * Frames with no address of their own, read under the origin they inherit.
 *
 * A `srcdoc` panel and a script-written `about:blank` document are how most
 * in-page editors and embedded previews are built. Both used to be dropped
 * before the run looked at them: a live run on a page whose content sat in a
 * srcdoc panel saw zero elements, searched three times and failed. These
 * gates prove the whole chain — selection, authorization by the creator's
 * origin, injection, the content-side origin, and validation — against a real
 * browser, which is the only place injection into such a frame can be
 * proved at all.
 */
const continueButton = `<button type="button" onclick="document.body.insertAdjacentHTML('beforeend','<p role=status>Status: Active</p>');this.disabled=true">Continue</button>`

const SRCDOC_PAGE = `<!doctype html>
<title>Panel</title>
<main>
  <h1>Account</h1>
  <iframe title="Account panel" width="400" height="160" srcdoc="${`<!doctype html><main>${continueButton}</main>`.replaceAll('"', "&quot;")}"></iframe>
</main>`

runAgentScenario({
  name: "reads and acts inside a srcdoc panel",
  goal: "Click Continue inside the panel and report the status.",
  status: "completed",
  timeoutMs: 120_000,
  allowRoutineActions: true,
  approvalScope: "run_origin",
  html: () => SRCDOC_PAGE,
  plan: [{ text: "report the status", kind: "read" }],
  decide: (observation: AgentFixtureObservation) => {
    if (observation.text.includes("Status: Active")) {
      return {
        type: "complete",
        summary: "Status: Active",
        sourceQuotes: [
          {
            quote: "Status: Active",
            ref: agentFixtureElement(
              observation,
              (element) => element.name === "Status: Active"
            )?.ref,
            requirementId: "r1"
          }
        ],
        outcomes: [{ id: "r1", met: true, evidence: "Status: Active" }]
      }
    }
    const button = agentFixtureElement(
      observation,
      (element) => element.name === "Continue"
    )
    return button
      ? { type: "click", ref: button.ref, requirementId: "r1" }
      : { type: "fail", reason: "The panel's button was not observed." }
  },
  verify: async ({ page, snapshot }) => {
    await expect(
      page.frameLocator("iframe").getByText("Status: Active")
    ).toBeVisible()
    expect(snapshot?.run?.status).toBe("completed")
  }
})

/**
 * The classic editor shape: an `about:blank` frame the page writes a
 * contenteditable body into.
 */
const EDITOR_PAGE = `<!doctype html>
<title>Editor</title>
<main>
  <h1>Compose</h1>
  <iframe id="editor" title="Message body" width="400" height="160"></iframe>
</main>
<script>
  const doc = document.getElementById("editor").contentDocument
  doc.open()
  doc.write('<!doctype html><body><div id="body" contenteditable="true" role="textbox" aria-label="Message body"></div></body>')
  doc.close()
</script>`

runAgentScenario({
  name: "types into a script-written about:blank editor",
  goal: 'Write "Hello team" in the message body. Do not send.',
  status: "completed",
  timeoutMs: 120_000,
  allowRoutineActions: true,
  approvalScope: "run_origin",
  html: () => EDITOR_PAGE,
  plan: [{ text: "the message body says Hello team", kind: "change" }],
  decide: (observation: AgentFixtureObservation) => {
    const editor = agentFixtureElement(
      observation,
      (element) => element.name === "Message body" && element.editable === true
    )
    if (editor?.value?.includes("Hello team")) {
      return {
        type: "complete",
        summary: "Wrote the message.",
        outcomes: [{ id: "r1", met: true, evidence: "Hello team" }]
      }
    }
    return editor
      ? {
          type: "clear_and_type",
          ref: editor.ref,
          text: "Hello team",
          requirementId: "r1"
        }
      : { type: "fail", reason: "The editor was not observed." }
  },
  verify: async ({ page, snapshot }) => {
    await expect(page.frameLocator("#editor").locator("#body")).toHaveText(
      "Hello team"
    )
    expect(snapshot?.run?.status).toBe("completed")
  }
})

/**
 * A sandbox without `allow-same-origin` makes the panel opaque: it inherits
 * nothing, and is never read or acted in, however readable the page is.
 */
const SANDBOXED_PAGE = `<!doctype html>
<title>Sandboxed</title>
<main>
  <h1>Preview</h1>
  <iframe sandbox="allow-scripts" title="Preview" width="400" height="160" srcdoc="${`<!doctype html><main>${continueButton}</main>`.replaceAll('"', "&quot;")}"></iframe>
</main>`

runAgentScenario({
  name: "never reads a sandboxed srcdoc panel",
  goal: "Click Continue inside the preview.",
  status: "failed",
  timeoutMs: 120_000,
  allowRoutineActions: true,
  html: () => SANDBOXED_PAGE,
  decide: (observation: AgentFixtureObservation) => {
    const button = agentFixtureElement(
      observation,
      (element) => element.name === "Continue"
    )
    return button
      ? { type: "click", ref: button.ref }
      : { type: "fail", reason: "The preview could not be read." }
  },
  verify: async ({ page, snapshot }) => {
    await expect(
      page.frameLocator("iframe").getByText("Status: Active")
    ).toHaveCount(0)
    expect(snapshot?.run?.status).toBe("failed")
    expect(snapshot?.steps.some((step) => step.command?.type === "click")).toBe(
      false
    )
  }
})
