import assert from "node:assert/strict"
import { test } from "node:test"
import { appendedAfterIntroduction } from "../qualification-score.mjs"

const text = "Draft for Widget. Ready for review."

test("an append joined by a space or one line break is the same append", () => {
  assert.equal(
    appendedAfterIntroduction(`Existing introduction. ${text}`, text),
    true
  )
  assert.equal(
    appendedAfterIntroduction(`Existing introduction.\n${text}`, text),
    true
  )
})

test("a changed introduction, a missing text or extra content is not an append", () => {
  assert.equal(appendedAfterIntroduction(text, text), false)
  assert.equal(
    appendedAfterIntroduction("Existing introduction. ", text),
    false
  )
  assert.equal(
    appendedAfterIntroduction(`Existing introduction!\n${text}`, text),
    false
  )
  assert.equal(
    appendedAfterIntroduction(`Existing introduction. ${text} More`, text),
    false
  )
  assert.equal(
    appendedAfterIntroduction(`Existing introduction.${text}`, text),
    false
  )
  assert.equal(appendedAfterIntroduction(undefined, text), false)
})
