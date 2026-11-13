import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

const form = `<label>Name<input id="name"></label><label>Color<select id="color"><option>Red</option><option>Blue</option></select></label><label><input id="agree" type="checkbox">Agree</label>`
const complete = {
  type: "complete",
  summary: "Name is Ada, Color is Blue and Agree is checked.",
  outcomes: [
    { id: "r1", met: true, evidence: "Ada" },
    { id: "r2", met: true, evidence: "Blue" },
    { id: "r3", met: true, evidence: "Agree" }
  ]
}

runAgentScenario({
  name: "combined-field-requirement-refuses-name-only-proof",
  goal: "Set Name to Ada, Color to Blue, and Agree checked. Do not submit.",
  plan: [
    {
      text: "Set Name to Ada, Color to Blue, and Agree checked",
      kind: "change",
      check: { type: "field", name: "Name", value: "Ada" }
    }
  ],
  status: "failed",
  html: () => `<!doctype html><title>Application</title><main>${form}</main>`,
  decide: (observation, { step }) => {
    if (step === 1)
      return {
        type: "fill_form",
        requirementId: "r1",
        fields: [
          {
            type: "clear_and_type",
            ref: agentFixtureElement(
              observation,
              (element) => element.name === "Name"
            )?.ref,
            text: "Ada"
          }
        ]
      }
    if (step === 2)
      return {
        type: "complete",
        summary: complete.summary,
        outcomes: [{ id: "r1", met: true, evidence: "Ada" }]
      }
    return {
      type: "fail",
      reason: "Only Name was filled; Color and Agree remain unmet."
    }
  },
  verify: async ({ page, snapshot }) => {
    await expect(page.locator("#name")).toHaveValue("Ada")
    await expect(page.locator("#color")).toHaveValue("Red")
    await expect(page.locator("#agree")).not.toBeChecked()
    expect(snapshot?.steps.some((step) => step.status === "rejected")).toBe(
      true
    )
    expect(snapshot?.run?.outcome?.met ?? []).toEqual([])
  }
})

for (const repair of [false, true])
  runAgentScenario({
    name: `field-values-reset-on-review-${repair ? "repaired" : "refused"}`,
    goal: "Set Name to Ada, Color to Blue, and Agree checked. Do not submit.",
    plan: [
      {
        text: "Name holds Ada",
        kind: "change",
        check: { type: "field", name: "Name", value: "Ada" }
      },
      {
        text: "Color is Blue",
        kind: "change",
        check: { type: "selected", name: "Color", value: "Blue" }
      },
      {
        text: "Agree is checked",
        kind: "change",
        check: { type: "checked", name: "Agree", checked: true }
      }
    ],
    status: repair ? "completed" : "failed",
    html: (path) => `<!doctype html><title>Application</title><main>${form}
    <script>const old=JSON.parse(sessionStorage.getItem('draft')||'{}');document.querySelector('#name').value=old.name||'';document.querySelector('#color').value=old.color||'Red';document.querySelector('#agree').checked=old.agree||false;${path === "/review" ? "document.querySelector('#color').value='Red';document.querySelector('#agree').checked=false" : ""}</script>
    ${path === "/review" ? "" : `<button type="button" onclick="sessionStorage.setItem('draft',JSON.stringify({name:document.querySelector('#name').value,color:document.querySelector('#color').value,agree:document.querySelector('#agree').checked}));location.href='/review'">Next</button>`}</main>`,
    decide: (observation, { step }) => {
      const ref = (name: string) =>
        agentFixtureElement(observation, (element) => element.name === name)
          ?.ref
      if (step === 1)
        return {
          type: "fill_form",
          requirementId: "r1",
          fields: [
            { type: "clear_and_type", ref: ref("Name"), text: "Ada" },
            { type: "select", ref: ref("Color"), value: "Blue" },
            { type: "check", ref: ref("Agree") }
          ]
        }
      if (step === 2)
        return { type: "click", ref: ref("Next"), requirementId: "r1" }
      if (step === 4)
        return repair
          ? {
              type: "fill_form",
              requirementId: "r2",
              fields: [
                { type: "select", ref: ref("Color"), value: "Blue" },
                { type: "check", ref: ref("Agree") }
              ]
            }
          : {
              type: "fail",
              reason:
                "Color and Agree changed on review; earlier field receipts do not establish their final state."
            }
      return complete
    },
    verify: async ({ page, snapshot }) => {
      await expect(page.locator("#name")).toHaveValue("Ada")
      await expect(page.locator("#color")).toHaveValue(repair ? "Blue" : "Red")
      expect(await page.locator("#agree").isChecked()).toBe(repair)
      expect(snapshot?.steps.some((step) => step.status === "rejected")).toBe(
        true
      )
      if (repair)
        expect(snapshot?.run?.outcome).toMatchObject({
          met: ["r1", "r2", "r3"],
          unmet: []
        })
    }
  })
