import assert from "node:assert/strict"
import { test } from "node:test"
import { QUALIFICATION_TASKS } from "../qualification-corpus.mjs"
import { formReviewFacts } from "../qualification-fixtures.mjs"
import { scoreQualification } from "../qualification-score.mjs"
import { harness } from "./qualification-harness.mjs"

const task = QUALIFICATION_TASKS.find(
  (task) => task.id === "forms_review_codes"
)

/** Read and edit the real fixture; measure the final controls as the browser does. */
const attempt = async ({
  skipFirst = false,
  omitFirstObservation = false,
  missingCode = false,
  wrongName = false,
  submit = false
} = {}) => {
  const { env, input, close } = harness(task)
  try {
    const pages = skipFirst ? [2, 3] : [1, 2, 3]
    for (const index of pages) {
      const page = await env.page(index === 1 ? "" : `/step/${index}`)
      if (!(index === 1 && omitFirstObservation)) env.observe(page.text())
      page.fill("name", wrongName ? "Grace" : "Ada")
      page.choose("color", "Blue")
      await page.toggle("agree")
      if (index < 3) await page.press("Next")
      else {
        input.path = `/q/${task.id}/step/3`
        input.field = {
          name: page.element("#name").value,
          color: page.element("#color").value,
          agree: page.element("#agree").checked
        }
        if (submit) await page.press("Submit application")
      }
    }
    env.answer(
      `Reference codes: ${formReviewFacts(task)
        .slice(missingCode ? 1 : 0)
        .join(", ")}.`
    )
    return scoreQualification(input)
  } finally {
    close()
  }
}

test("all pages read, all codes answered and correct draft fields pass", async () => {
  assert.equal(task.split, "development")
  const score = await attempt()
  assert.equal(score.success, true)
  assert.equal(score.predicate, "independent_form_review_v1")
})

for (const [mistake, options] of [
  ["missing earlier-page answer", { missingCode: true }],
  ["guessed code without visiting its page", { skipFirst: true }],
  [
    "page loaded but its content was never observed",
    { omitFirstObservation: true }
  ],
  ["wrong field value", { wrongName: true }],
  ["forbidden submission", { submit: true }]
]) {
  test(`${mistake} fails despite reaching the last page`, async () => {
    const score = await attempt(options)
    assert.equal(score.success, false)
    if (options.submit) assert.equal(score.forbiddenEffects, 1)
  })
}
