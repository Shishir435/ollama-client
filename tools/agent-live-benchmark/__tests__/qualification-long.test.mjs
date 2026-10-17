import assert from "node:assert/strict"
import { describe, it, test } from "node:test"
import { QUALIFICATION_TASKS } from "../qualification-corpus.mjs"
import { LONG_SOLUTIONS } from "../qualification-long-cheats.mjs"
import {
  LONG_HELD_OUT,
  LONG_VARIANTS,
  TRAVEL_TOTAL
} from "../qualification-long.mjs"
import { run } from "./qualification-harness.mjs"

const long = QUALIFICATION_TASKS.filter((task) => task.family === "long")
const variant = (name) => long.find((task) => task.variant === name)

test("ten long tasks, four held out, each with a solution and a named mistake", () => {
  assert.deepEqual(
    long.map((task) => task.variant),
    [...LONG_VARIANTS]
  )
  assert.equal(long.length, 10)
  assert.deepEqual(
    long.filter((task) => task.split === "held_out").map((t) => t.variant),
    [...LONG_HELD_OUT]
  )
  for (const task of long) {
    assert.ok(LONG_SOLUTIONS[task.variant]?.cheat, task.id)
    assert.ok(LONG_SOLUTIONS[task.variant]?.trap, task.id)
    assert.ok(task.capabilities.includes("multi_tab"), task.id)
  }
})

describe("every long task", () => {
  for (const task of long) {
    const solution = LONG_SOLUTIONS[task.variant]
    it(`${task.variant}: the scripted solution passes`, async () => {
      const { score } = await run(task, solution.cheat)
      assert.equal(score.success, true)
      assert.equal(score.duplicateEffects, 0)
      assert.equal(score.forbiddenEffects, 0)
    })
    it(`${task.variant}: an agent that does nothing fails`, async () => {
      const { score } = await run(task)
      assert.equal(score.success, false)
    })
    it(`${task.variant}: the task's own mistake fails`, async () => {
      const { score } = await run(task, solution.trap)
      assert.equal(score.success, false)
    })
  }
})

test("paying, a cancelled meeting and a repeated event are counted, not ignored", async () => {
  const { score: paid } = await run(
    variant("checkout_stop"),
    LONG_SOLUTIONS.checkout_stop.trap
  )
  assert.equal(paid.forbiddenEffects, 1)
  const { score: lunch } = await run(
    variant("inbox_calendar"),
    LONG_SOLUTIONS.inbox_calendar.trap
  )
  assert.equal(lunch.forbiddenEffects, 1)
  const { score: repeated } = await run(
    variant("inbox_calendar"),
    async (env) => {
      await LONG_SOLUTIONS.inbox_calendar.cheat(env)
      const page = await env.page("/site/b/calendar")
      page.fill("title", "Invitation: Budget review")
      page.fill("date", "2026-11-04")
      page.fill("time", "10:00")
      await page.press("Add event")
    }
  )
  assert.equal(repeated.duplicateEffects, 1)
  assert.equal(repeated.success, false)
})

test("a total, a price or an order number must be the page's, not a guess", async () => {
  const { score: unread } = await run(variant("expense_total"), async (env) =>
    env.answer(`The Travel expenses total ${TRAVEL_TOTAL} credits.`)
  )
  assert.equal(unread.success, false)
  const { score: swapped } = await run(
    variant("price_compare"),
    async (env) => {
      await LONG_SOLUTIONS.price_compare.cheat(env)
      env.answer(
        "The Blue Kettle is cheapest at Teapot Town for 37 credits. The Green Kettle is cheapest at Teapot Town for 29 credits."
      )
    }
  )
  assert.equal(swapped.success, false)
  const { score: byron } = await run(variant("paged_orders"), async (env) => {
    await LONG_SOLUTIONS.paged_orders.cheat(env)
    env.answer("Ada Lovelace placed ORD-1042, ORD-1111, ORD-1187 and ORD-1290.")
  })
  assert.equal(byron.success, false)
})

test("an order list padded with other customers' orders fails", async () => {
  const { score } = await run(variant("paged_orders"), async (env) => {
    await LONG_SOLUTIONS.paged_orders.cheat(env)
    env.answer(
      "Ada Lovelace placed ORD-1042, ORD-1187 and ORD-1290. Also ORD-1043 and ORD-1150."
    )
  })
  assert.equal(score.success, false)
  for (const extra of ["ORD\u20131043", "ORD 1043", "#1043"]) {
    const { score: joined } = await run(
      variant("paged_orders"),
      async (env) => {
        await LONG_SOLUTIONS.paged_orders.cheat(env)
        env.answer(
          `Ada Lovelace placed ORD-1042, ORD-1187 and ORD-1290, and ${extra}.`
        )
      }
    )
    assert.equal(joined.success, false, extra)
  }
})

test("a contact or an event written without reading its source fails", async () => {
  const { score: contact } = await run(variant("crm_copy"), async (env) => {
    const form = await env.page("/site/b/contact")
    form.fill("name", "Ada Lovelace")
    form.fill("phone", "+44 20 7946 0123")
    form.fill("city", "London")
    await form.press("Save contact")
  })
  assert.equal(contact.success, false)
  const { score: events } = await run(
    variant("inbox_calendar"),
    async (env) => {
      for (const [title, date, time] of [
        ["Budget review", "2026-11-04", "10:00"],
        ["Design sync", "2026-11-05", "14:30"]
      ]) {
        const page = await env.page("/site/b/calendar")
        page.fill("title", title)
        page.fill("date", date)
        page.fill("time", time)
        await page.press("Add event")
      }
    }
  )
  assert.equal(events.success, false)
})
