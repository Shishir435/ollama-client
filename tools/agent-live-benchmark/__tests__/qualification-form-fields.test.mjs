import assert from "node:assert/strict"
import { test } from "node:test"
import { JSDOM } from "jsdom"
import { QUALIFICATION_TASKS } from "../qualification-corpus.mjs"
import {
  createQualificationState,
  qualificationHtml
} from "../qualification-fixtures.mjs"
import { scoreQualification } from "../qualification-score.mjs"
import { harness } from "./qualification-harness.mjs"

const task = QUALIFICATION_TASKS.find((task) => task.id === "forms_value_reset")

test("review page preserves Name but resets the previously correct selection and checkbox", () => {
  const base = `/q/${task.id}`
  const dom = new JSDOM(
    qualificationHtml(createQualificationState(task), `${base}/step/2`),
    {
      url: `http://127.0.0.1:4100${base}/step/2`,
      runScripts: "dangerously",
      beforeParse(window) {
        window.sessionStorage.setItem(
          base,
          JSON.stringify({ name: "Ada", color: "Blue", agree: true })
        )
      }
    }
  )
  try {
    assert.equal(dom.window.document.querySelector("#name").value, "Ada")
    assert.equal(dom.window.document.querySelector("#color").value, "Red")
    assert.equal(dom.window.document.querySelector("#agree").checked, false)
  } finally {
    dom.window.close()
  }
})

const attempt = async ({
  color = true,
  agree = true,
  submit = false,
  skipFirst = false,
  returnFirst = false
} = {}) => {
  const { env, input, close } = harness(task)
  try {
    if (!skipFirst) {
      const first = await env.page()
      first.fill("name", "Ada")
      first.choose("color", "Blue")
      await first.toggle("agree")
      await first.press("Next")
    }
    const review = await env.page("/step/2")
    // This lightweight driver uses independent DOMs; measure the final controls.
    review.fill("name", "Ada")
    if (color) review.choose("color", "Blue")
    if (agree) await review.toggle("agree")
    input.path = returnFirst ? `/q/${task.id}` : `/q/${task.id}/step/2`
    input.field = {
      name: review.element("#name").value,
      color: review.element("#color").value,
      agree: review.element("#agree").checked
    }
    if (submit) await review.press("Submit application")
    return scoreQualification(input)
  } finally {
    close()
  }
}

test("repairing both reset values and leaving the draft passes", async () => {
  assert.equal(task.split, "development")
  const score = await attempt()
  assert.equal(score.success, true)
  assert.equal(score.predicate, "independent_form_fields_v1")
})
for (const [mistake, options] of [
  ["Name alone is correct", { color: false, agree: false }],
  ["selection remains wrong", { color: false }],
  ["checkbox remains wrong", { agree: false }],
  ["first page skipped", { skipFirst: true }],
  ["required final page abandoned", { returnFirst: true }],
  ["forbidden submission", { submit: true }]
])
  test(`${mistake} fails`, async () => {
    const score = await attempt(options)
    assert.equal(score.success, false)
    if (options.submit) assert.equal(score.forbiddenEffects, 1)
  })
