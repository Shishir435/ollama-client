import {
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"

for (const correctRecord of [true, false]) {
  runAgentScenario({
    name: `record-form-heading-${correctRecord ? "matches" : "contradicts"}`,
    goal: "Set Name to Ada, Color to Blue and Agree checked for Record 4. Review both pages. Do not submit.",
    plan: [
      {
        text: "Name holds Ada for Record 4",
        kind: "change",
        check: { type: "field", name: "Name", value: "Ada", record: "Record 4" }
      },
      {
        text: "Color is Blue for Record 4",
        kind: "change",
        check: {
          type: "selected",
          name: "Color",
          value: "Blue",
          record: "Record 4"
        }
      },
      {
        text: "Agree is checked for Record 4",
        kind: "change",
        check: {
          type: "checked",
          name: "Agree",
          checked: true,
          record: "Record 4"
        }
      },
      { text: "Review both pages", kind: "read" }
    ],
    status: correctRecord ? "completed" : "failed",
    html: (path) => {
      const second = path.startsWith("/page-two")
      return `<!doctype html><title>Application</title><main>
        <h1>Application for Record ${second && !correctRecord ? 5 : 4}, page ${second ? 2 : 1}</h1>
        <label>Name<input id="name"></label>
        <label>Color<select id="color"><option>Red</option><option>Blue</option></select></label>
        <label><input id="agree" type="checkbox">Agree</label>
        <script>const old=JSON.parse(sessionStorage.getItem('application')||'{}');document.querySelector('#name').value=old.name||'';document.querySelector('#color').value=old.color||'Red';document.querySelector('#agree').checked=old.agree||false</script>
        ${second ? "" : `<button onclick="sessionStorage.setItem('application',JSON.stringify({name:document.querySelector('#name').value,color:document.querySelector('#color').value,agree:document.querySelector('#agree').checked}));location.href='/page-two'">Next</button>`}
      </main>`
    },
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
        return {
          type: "click",
          requirementId: "r4",
          ref: ref("Next"),
          sourceQuotes: [
            { requirementId: "r4", quote: "Application for Record 4, page 1" }
          ]
        }
      if (!correctRecord && step > 3)
        return {
          type: "complete",
          summary:
            "The next page belongs to another record; could not establish the requested final state.",
          outcomes: [1, 2, 3, 4].map((i) => ({ id: `r${i}`, met: false }))
        }
      return {
        type: "complete",
        summary:
          "Filled all three values and reviewed both application pages without submitting.",
        outcomes: [
          { id: "r1", met: true, evidence: "Ada" },
          { id: "r2", met: true, evidence: "Blue" },
          { id: "r3", met: true, evidence: "Agree" },
          {
            id: "r4",
            met: true,
            evidence: `Application for Record ${correctRecord ? 4 : 5}, page 2`
          }
        ]
      }
    },
    review: (evidence) => [
      {
        id: "r4",
        verdict: "supported",
        sources: evidence
          .filter((record) =>
            record.quote?.startsWith("Application for Record")
          )
          .map(({ id }) => id)
      }
    ],
    verify: async ({ page, snapshot }) => {
      await expect(page.locator("#name")).toHaveValue("Ada")
      await expect(page.locator("#color")).toHaveValue("Blue")
      await expect(page.locator("#agree")).toBeChecked()
      if (correctRecord) {
        expect(snapshot?.run?.outcome?.met).toEqual(["r1", "r2", "r3", "r4"])
        expect(snapshot?.run?.outcome?.claimed ?? []).toEqual([])
      } else {
        expect(snapshot?.run?.outcome?.unmet).toEqual(["r1", "r2", "r3", "r4"])
        expect(snapshot?.steps.some((step) => step.status === "rejected")).toBe(
          true
        )
      }
    }
  })
}
