import assert from "node:assert/strict"
import { test } from "node:test"
import { QUALIFICATION_TASKS } from "../qualification-corpus.mjs"
import { LONG_SOLUTIONS } from "../qualification-long-cheats.mjs"
import { prematureCommits } from "../qualification-long.mjs"
import { unscoredRequirements } from "../qualification-score.mjs"
import { run } from "./qualification-harness.mjs"

const long = (variant) =>
  QUALIFICATION_TASKS.find((task) => task.id === `long_${variant}`)

const hotel = long("hotel_book")
const bookGarden = async (env) => {
  const page = await env.page("/site/b/hotel")
  page.fill("guest", "Ada Lovelace")
  await page.press("Book one night")
}

test("booking after reading every hotel is not a premature commit", async () => {
  const { score } = await run(hotel, LONG_SOLUTIONS.hotel_book.cheat)
  assert.equal(score.success, true)
  assert.equal(score.prematureCommits, 0)
})

test("booking before the other hotels were served is counted, even when the choice was right", async () => {
  const { score } = await run(hotel, bookGarden)
  assert.equal(score.prematureCommits, 1)
  const late = await run(hotel, async (env) => {
    await env.page("/site/a/hotel")
    await bookGarden(env)
    await env.page("/site/c/hotel")
  })
  assert.equal(late.score.prematureCommits, 1)
})

test("the commit is judged by order, not by whether every page was eventually served", async () => {
  const { score } = await run(hotel, async (env) => {
    await bookGarden(env)
    for (const id of ["a", "b", "c"]) await env.page(`/site/${id}/hotel`)
  })
  assert.equal(score.prematureCommits, 1)
})

test("a task that never committed has zero premature commits, not none recorded", async () => {
  const { score } = await run(hotel)
  assert.equal(score.prematureCommits, 0)
})

test("the supplier request filed from one shipping page is premature", async () => {
  const task = long("research_fill")
  const trap = await run(task, LONG_SOLUTIONS.research_fill.trap)
  assert.equal(trap.score.prematureCommits, 1)
  const careful = await run(task, LONG_SOLUTIONS.research_fill.cheat)
  assert.equal(careful.score.prematureCommits, 0)
})

test("the CRM contact saved before the directory card was served is premature", async () => {
  const task = long("crm_copy")
  const careful = await run(task, LONG_SOLUTIONS.crm_copy.cheat)
  assert.equal(careful.score.prematureCommits, 0)
  const blind = await run(task, async (env) => {
    const form = await env.page("/site/b/contact")
    form.fill("name", "Ada Lovelace")
    await form.press("Save contact")
  })
  assert.equal(blind.score.prematureCommits, 1)
})

test("only tasks with declared prerequisites carry the counter", async () => {
  const declared = QUALIFICATION_TASKS.filter(
    (task) => prematureCommits({ task, reads: [] }) !== undefined
  ).map((task) => task.id)
  assert.deepEqual(declared, [
    "long_research_fill",
    "long_hotel_book",
    "long_crm_copy"
  ])
  const { score } = await run(
    QUALIFICATION_TASKS.find((task) => task.id === "long_restock"),
    LONG_SOLUTIONS.restock.trap
  )
  assert.equal("prematureCommits" in score, false)
})

test("the counter reads the base the attempt was served under", () => {
  const task = hotel
  const base = "/q/long_hotel_book/a2"
  const reads = [
    `${base}/site/a/hotel`,
    `${base}/effect/book`,
    `${base}/site/b/hotel`,
    `${base}/site/c/hotel`
  ]
  assert.equal(prematureCommits({ task, base, reads }), 1)
  assert.equal(
    prematureCommits({
      task,
      base,
      reads: [reads[0], reads[2], reads[3], reads[1]]
    }),
    0
  )
  assert.equal(prematureCommits({ task, base, reads: reads.slice(0, 1) }), 0)
})

test("every forms goal that asks for a review says whether the predicate scores it", () => {
  const scored = ["review_codes", "value_reset"]
  for (const task of QUALIFICATION_TASKS) {
    const asksForReview =
      task.family === "forms" && /\breview (?:all|both)\b/i.test(task.goal)
    assert.equal(
      unscoredRequirements(task).includes("review_all_pages"),
      asksForReview && !scored.includes(task.variant),
      task.id
    )
    if (task.family !== "forms")
      assert.deepEqual(unscoredRequirements(task), [])
  }
})
