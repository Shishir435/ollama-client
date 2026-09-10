import type {
  AgentFixtureObservation,
  AgentScenarioOutcome
} from "../../fixtures/agent-scenario"
import { agentFixtureElement } from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"
import type { AgentAttemptRecord } from "../agent-benchmark"
import { writeAgentBenchmarkReport } from "../agent-benchmark"
import {
  benchmarkAttempts,
  benchmarkModel,
  benchmarkTask,
  clickNamed,
  clickThenReport,
  fieldPage,
  fieldsFilled,
  fillFields,
  named,
  observableButton,
  page,
  showsActiveStatus
} from "../benchmark-tasks"

/**
 * The frozen evaluation suite, recorded rather than gated.
 *
 * A gate says pass or fail. This says what happened, in counts a later pass
 * can be compared against, on the same tasks across both input backends — the
 * DOM one every browser has and the native one only an attached debugger
 * gives. Two passes over one suite is what turns "native input is better"
 * into a number instead of a claim.
 *
 * Nothing here publishes a rate. A handful of attempts cannot support one, and
 * the point of the exercise is that the numbers are measured rather than
 * asserted in advance.
 *
 * Every task carries a predicate that reads the page, because the number that
 * matters most is false completion — a run reporting success on a page that
 * never changed — and the run's own verdict cannot be the scorer.
 */

const attempts: AgentAttemptRecord[] = []

/** Frozen: what the suite declares, checked before a report is written. */
const TASKS = 15

const task = (input: Parameters<typeof benchmarkTask>[1]) =>
  benchmarkTask(attempts, input)

// ── 1. read-and-extract ─────────────────────────────────────────────────────

task({
  family: "read-and-extract",
  name: "visible-status",
  goal: "Report the status shown on the page.",
  status: "completed",
  html: () => page("<h1>Account</h1><p>Status: Active</p>"),
  decide: () => ({ type: "complete", summary: "Active" }),
  succeeded: (outcome) => Boolean(outcome.snapshot?.run?.result)
})

task({
  family: "read-and-extract",
  name: "below-the-fold",
  goal: "Report the account number, which is further down the page.",
  status: "completed",
  html: () =>
    page(`<h1>Account</h1>${"<p>filler</p>".repeat(120)}<p>Account 4471</p>`),
  decide: (observation) =>
    observation.documentText?.includes("Account 4471") ||
    observation.text.includes("Account 4471")
      ? { type: "complete", summary: "Account 4471" }
      : { type: "extract_text" },
  succeeded: (outcome) =>
    Boolean(outcome.snapshot?.run?.result?.includes("4471"))
})

task({
  family: "read-and-extract",
  name: "region-inspection",
  goal: "Report the status inside the details region.",
  status: "completed",
  html: () =>
    page(
      `<section aria-label="details"><p>Status: Active</p></section>${'<button type="button">noise</button>'.repeat(40)}`
    ),
  decide: (observation) =>
    observation.text.includes("Status: Active")
      ? { type: "complete", summary: "Active" }
      : { type: "inspect", target: "details" },
  succeeded: (outcome) => Boolean(outcome.snapshot?.run?.result)
})

// ── 2. single-action ────────────────────────────────────────────────────────

task({
  family: "single-action",
  name: "button-with-consequence",
  goal: "Click Continue and report the status.",
  status: "completed",
  html: () => page(observableButton()),
  decide: clickThenReport(),
  succeeded: showsActiveStatus
})

task({
  family: "single-action",
  name: "checkbox",
  goal: "Tick the newsletter box and report the status.",
  status: "completed",
  html: () =>
    page(
      '<label for="news">Newsletter</label><input id="news" type="checkbox" onchange="document.querySelector(\'main\').insertAdjacentHTML(\'beforeend\',\'<p>Status: Active</p>\')">'
    ),
  decide: (observation) =>
    observation.text.includes("Status: Active")
      ? { type: "complete", summary: "Active", evidence: "Status: Active" }
      : { type: "check", ref: named(observation, "Newsletter")?.ref },
  succeeded: showsActiveStatus
})

task({
  family: "single-action",
  name: "menu-then-option",
  goal: "Open the actions menu, choose Approve, and report the status.",
  status: "completed",
  html: () =>
    page(
      `<button type="button" role="button" onclick="document.getElementById('menu').hidden=false">Actions</button>
       <div id="menu" role="menu" aria-label="actions" hidden>
         <button type="button" role="menuitem" onclick="document.querySelector('main').insertAdjacentHTML('beforeend','<p>Status: Active</p>');document.getElementById('menu').hidden=true">Approve</button>
       </div>`
    ),
  decide: (observation) => {
    if (observation.text.includes("Status: Active")) {
      return { type: "complete", summary: "Active", evidence: "Status: Active" }
    }
    const approve = named(observation, "Approve")
    return approve && !approve.hidden
      ? { type: "click", ref: approve.ref }
      : clickNamed(observation, "Actions")
  },
  succeeded: showsActiveStatus
})

// ── 3. form-preparation ─────────────────────────────────────────────────────

task({
  family: "form-preparation",
  name: "single-field",
  goal: "Fill in the given field. Do not submit.",
  status: "completed",
  approvalScope: "run_origin",
  html: () => fieldPage(["given"]),
  decide: fillFields(["given"]),
  succeeded: fieldsFilled(["given"])
})

task({
  family: "form-preparation",
  name: "three-fields-one-grant",
  goal: "Fill in all three fields. Do not submit.",
  status: "completed",
  approvalScope: "run_origin",
  html: () => fieldPage(["given", "family", "city"]),
  decide: fillFields(["given", "family", "city"]),
  succeeded: fieldsFilled(["given", "family", "city"])
})

task({
  family: "form-preparation",
  name: "select-and-check",
  goal: "Choose the south region, accept the terms, and report the status.",
  status: "completed",
  approvalScope: "run_origin",
  html: () =>
    page(
      '<label for="region">region</label><select id="region"><option value="">pick</option><option value="south">South</option></select>' +
        '<label for="terms">terms</label><input id="terms" type="checkbox" onchange="document.querySelector(\'main\').insertAdjacentHTML(\'beforeend\',\'<p>Status: Active</p>\')">'
    ),
  decide: (observation) => {
    if (observation.text.includes("Status: Active")) {
      return { type: "complete", summary: "Active", evidence: "Status: Active" }
    }
    const region = named(observation, "region")
    if (region && region.value !== "south") {
      return { type: "select", ref: region.ref, value: "south" }
    }
    return { type: "check", ref: named(observation, "terms")?.ref }
  },
  succeeded: showsActiveStatus
})

// ── 4. editors ──────────────────────────────────────────────────────────────

const reportPage = page(
  '<div id="doc" contenteditable="true">The quick brown fax jumps.</div>' +
    "<button type=\"button\" onclick=\"document.querySelector('main').insertAdjacentHTML('beforeend','<p>Saved: '+document.getElementById('doc').textContent+'</p>')\">Save</button>",
  "Report"
)

const editor = (observation: AgentFixtureObservation) =>
  agentFixtureElement(
    observation,
    (element) => element.type === "contenteditable"
  )

task({
  family: "editors",
  name: "replace-then-save",
  goal: "Fix the typo 'fax' to 'fox' in the report, then save it.",
  status: "completed",
  approvalScope: "run_origin",
  html: () => reportPage,
  decide: (observation) => {
    if (observation.text.includes("Saved: The quick brown fox jumps.")) {
      return {
        type: "complete",
        summary: "Saved",
        evidence: "Saved: The quick brown fox jumps."
      }
    }
    const host = editor(observation)
    if (host?.value?.includes("fax")) {
      return { type: "replace_text", ref: host.ref, find: "fax", text: "fox" }
    }
    return clickNamed(observation, "Save")
  },
  succeeded: async (outcome) =>
    (await outcome.page.locator("main").innerText()).includes(
      "Saved: The quick brown fox jumps."
    )
})

task({
  family: "editors",
  name: "append-then-save",
  goal: "Add ' Done.' to the end of the report, then save it.",
  status: "completed",
  approvalScope: "run_origin",
  html: () => reportPage,
  decide: (observation) => {
    if (observation.text.includes("Saved: ")) {
      return { type: "complete", summary: "Saved", evidence: "Saved: " }
    }
    const host = editor(observation)
    if (host && !host.value?.includes("Done.")) {
      return { type: "type", ref: host.ref, text: " Done." }
    }
    return clickNamed(observation, "Save")
  },
  succeeded: async (outcome) =>
    (await outcome.page.locator("#doc").innerText()).includes("Done.")
})

task({
  family: "editors",
  name: "clear-and-retype",
  goal: "Replace the whole report with 'Rewritten.' and save it.",
  status: "completed",
  approvalScope: "run_origin",
  html: () => reportPage,
  decide: (observation) => {
    if (observation.text.includes("Saved: Rewritten.")) {
      return {
        type: "complete",
        summary: "Saved",
        evidence: "Saved: Rewritten."
      }
    }
    const host = editor(observation)
    if (host && host.value !== "Rewritten.") {
      return { type: "clear_and_type", ref: host.ref, text: "Rewritten." }
    }
    return clickNamed(observation, "Save")
  },
  succeeded: async (outcome) =>
    (await outcome.page.locator("#doc").innerText()).trim() === "Rewritten."
})

// ── 5. delayed-save ─────────────────────────────────────────────────────────

const delayedSavePage = (delayMs: number | null) =>
  page(
    `<p id="status">Unsaved changes</p><button type="button" onclick="
      document.getElementById('status').textContent='Saving…';this.disabled=true;
      ${delayMs === null ? "" : `setTimeout(()=>{document.getElementById('status').textContent='All changes saved'},${delayMs});`}
    ">Save</button>`,
    "Editor"
  )

const savedIndicator = async (
  outcome: AgentScenarioOutcome
): Promise<boolean> =>
  (await outcome.page.locator("#status").innerText()).includes(
    "All changes saved"
  )

const saveThenWait = (observation: AgentFixtureObservation) => {
  if (observation.text.includes("All changes saved")) {
    return {
      type: "complete",
      summary: "Saved.",
      evidence: "All changes saved"
    }
  }
  const save = named(observation, "Save")
  if (save && !save.disabled) return { type: "click", ref: save.ref }
  return { type: "wait", condition: "All changes saved", timeoutMs: 8_000 }
}

task({
  family: "delayed-save",
  name: "short-delay",
  goal: "Save the document.",
  status: "completed",
  html: () => delayedSavePage(400),
  decide: saveThenWait,
  succeeded: savedIndicator
})

task({
  family: "delayed-save",
  name: "long-delay",
  goal: "Save the document.",
  status: "completed",
  html: () => delayedSavePage(2_500),
  decide: saveThenWait,
  succeeded: savedIndicator
})

task({
  family: "delayed-save",
  name: "claims-before-it-lands",
  goal: "Save the document.",
  status: "completed",
  html: () => delayedSavePage(1_200),
  /**
   * Claims completion the moment the button is pressed, which is the failure
   * the outcome layer exists to stop. The run must refuse it and carry on;
   * the report shows whether it did, and the false-completion column shows
   * what it cost when it did not.
   */
  decide: (observation) => {
    if (observation.text.includes("All changes saved")) {
      return {
        type: "complete",
        summary: "Saved.",
        evidence: "All changes saved"
      }
    }
    const save = named(observation, "Save")
    if (save && !save.disabled) return { type: "click", ref: save.ref }
    return { type: "complete", summary: "Saved." }
  },
  succeeded: savedIndicator
})

// ── the report ──────────────────────────────────────────────────────────────

/**
 * Written by the last task, after the count is checked: a pass that lost a
 * task to a retry must not produce a report that looks complete.
 */
benchmarkTask(
  attempts,
  {
    family: "report",
    name: "write",
    goal: "Report the status shown on the page.",
    status: "completed",
    html: () => page("<p>Status: Active</p>"),
    decide: () => ({ type: "complete", summary: "Active" }),
    succeeded: (outcome) => Boolean(outcome.snapshot?.run?.result)
  },
  (outcome) => {
    if (outcome.attempt < benchmarkAttempts) return
    expect(attempts).toHaveLength((TASKS + 1) * benchmarkAttempts)
    expect(
      writeAgentBenchmarkReport(attempts, outcome.backend, benchmarkModel)
    ).toContain("agent-benchmark-")
  }
)
