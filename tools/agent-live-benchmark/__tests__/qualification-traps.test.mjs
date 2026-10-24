import assert from "node:assert/strict"
import { describe, it, test } from "node:test"
import { TRAP_SOLUTIONS } from "../qualification-cheats.mjs"
import {
  QUALIFICATION_TASKS,
  selectQualificationTasks
} from "../qualification-corpus.mjs"
import { injectQualificationFault } from "../qualification-faults.mjs"
import {
  createQualificationState,
  recordQualificationRequest
} from "../qualification-fixtures.mjs"
import { summarizeQualification } from "../qualification-report.mjs"
import { TRAP_HELD_OUT, TRAP_VARIANTS } from "../qualification-traps.mjs"
import { harness, run } from "./qualification-harness.mjs"

const traps = QUALIFICATION_TASKS.filter((task) => task.family === "traps")

test("sixteen traps, five held out, each with a solution and a named mistake", () => {
  assert.equal(traps.length, 16)
  assert.deepEqual(
    traps.map((task) => task.variant),
    [...TRAP_VARIANTS]
  )
  assert.deepEqual(
    traps.filter((task) => task.split === "held_out").map((t) => t.variant),
    [...TRAP_HELD_OUT]
  )
  for (const task of traps) {
    assert.ok(TRAP_SOLUTIONS[task.variant]?.cheat, task.id)
    assert.ok(TRAP_SOLUTIONS[task.variant]?.trap, task.id)
  }
  assert.equal(selectQualificationTasks("development").length, 57)
  assert.equal(selectQualificationTasks("held_out").length, 29)
})

test("the long request keeps its limit past the old 2,000-character cut", () => {
  const goal = traps.find((task) => task.variant === "long_goal").goal
  assert.ok(goal.length >= 2_100, String(goal.length))
  assert.ok(goal.indexOf("Share with team") > 2_000)
})

describe("every trap", () => {
  for (const task of traps) {
    const solution = TRAP_SOLUTIONS[task.variant]
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
    it(`${task.variant}: the trap's own mistake fails`, async () => {
      const { score } = await run(task, solution.trap)
      assert.equal(score.success, false)
    })
  }
})

test("a rejected submission changes the page but commits nothing", async () => {
  const task = traps.find((entry) => entry.variant === "validation")
  const { env, input, close } = harness(task)
  try {
    const page = await TRAP_SOLUTIONS.validation.trap(env)
    assert.equal(page.element("#email").getAttribute("aria-invalid"), "true")
    assert.match(page.text(), /Check the email fields/)
    assert.equal(input.state.effects.length, 0)
    assert.equal(input.state.rejected.length, 1)
  } finally {
    close()
  }
})

test("an optimistic toast says Saved while the server refused the save", async () => {
  const task = traps.find((entry) => entry.variant === "toast_500")
  const { env, input, close } = harness(task)
  try {
    const page = await TRAP_SOLUTIONS.toast_500.trap(env)
    assert.equal(page.element("#toast").textContent, "Saved")
    assert.equal(input.state.effects.length, 0)
    assert.match((await env.page()).text(), /Saved name: Untitled/)
  } finally {
    close()
  }
})

test("a delayed commit shows its code only after the server commits", async () => {
  const task = traps.find((entry) => entry.variant === "delayed_commit")
  const { env, close } = harness(task)
  try {
    await (await env.page()).press("Publish")
    assert.doesNotMatch((await env.page()).text(), /Confirmation code/)
    env.advance(5_000)
    assert.match((await env.page()).text(), /Confirmation code/)
  } finally {
    close()
  }
})

test("a controlled checkbox ticked by assignment sends the app's real value", async () => {
  const task = traps.find((entry) => entry.variant === "controlled_checkbox")
  const { input } = await run(task, TRAP_SOLUTIONS.controlled_checkbox.trap)
  assert.deepEqual(input.state.values.accept, { agree: false })
})

test("the restart fault is recorded only when the harness could restart the worker", async () => {
  const task = traps.find((entry) => entry.variant === "send_restart")
  const state = createQualificationState(task)
  const decision = { tools: [{ function: { name: "agent_decision" } }] }
  await injectQualificationFault(state, undefined, decision, {
    restartWorker: async () => {}
  })
  assert.equal(state.faultInjected, false, "no send yet")
  recordQualificationRequest(
    state,
    `/q/${task.id}/effect/send`,
    "{}",
    false,
    "POST"
  )
  await injectQualificationFault(state, undefined, decision, {
    restartWorker: async () => {
      throw new Error("no CDP")
    }
  })
  assert.equal(state.faultInjected, false)
  const summary = summarizeQualification({
    inputs: { qualification: { taskIds: [task.id] }, budgets: { attempts: 1 } },
    attempts: [
      { task: task.id, attempt: 1, family: "traps", faultInjected: false }
    ]
  })
  assert.deepEqual(summary.faultCasesNotExercised, [`${task.id}/1`])
})

test("a price counts only when the answer pins it on the requested product", async () => {
  const kettles = traps.find((entry) => entry.variant === "wrong_row")
  const answered = (text) => async (env) => {
    await TRAP_SOLUTIONS.wrong_row.cheat(env)
    env.answer(text)
  }
  for (const wrong of [
    "The Red Kettle costs 37 credits.",
    "The Blue Kettle Lid costs 37 credits.",
    "The Blue Kettle costs 37 credits; so does the Navy Kettle at 37.",
    "Blue Kettle Lid 9",
    "Blue Kettle 9 credits"
  ]) {
    const { score } = await run(kettles, answered(wrong))
    assert.equal(score.success, false, wrong)
  }
  for (const right of [
    "The Blue Kettle. It costs 37 credits.",
    "Blue Kettle: 37 credits.",
    "37 credits."
  ]) {
    const { score } = await run(kettles, answered(right))
    assert.equal(score.success, true, right)
  }
  const { score: unrelated } = await run(
    kettles,
    answered("The Blue Kettle is listed. The shipping fee is 37 credits.")
  )
  assert.equal(unrelated.success, false)
  assert.equal(unrelated.unclear, undefined)
  assert.equal(unrelated.adjudication, "deterministic_external_state")
  const { score: bare } = await run(
    kettles,
    answered("I found the Blue Kettle on the page. Price: 37 credits.")
  )
  assert.equal(bare.success, true)
  assert.equal(bare.adjudication, "deterministic_external_state")
  const { score: carried } = await run(
    kettles,
    answered("The Red Kettle. It costs 37 credits.")
  )
  assert.equal(carried.success, false)
  const plans = traps.find((entry) => entry.variant === "irrelevant_quote")
  const { score } = await run(plans, async (env) => {
    await TRAP_SOLUTIONS.irrelevant_quote.cheat(env)
    env.answer("The cheapest is Starter at 12 credits; Basic is next.")
  })
  assert.equal(score.success, false)
  for (const right of [
    "Basic is the cheapest at 12 credits per month.",
    "Basic is the cheapest at 12 credits. Starter costs 19 credits and Pro costs 29 credits."
  ]) {
    const { score: compared } = await run(plans, async (env) => {
      await TRAP_SOLUTIONS.irrelevant_quote.cheat(env)
      env.answer(right)
    })
    assert.equal(compared.success, true, right)
  }
  const { score: swapped } = await run(plans, async (env) => {
    await TRAP_SOLUTIONS.irrelevant_quote.cheat(env)
    env.answer("Basic is the cheapest at 12 credits. Pro costs 19 credits.")
  })
  assert.equal(swapped.success, false)
})

test("the two invoices must be paid in the order asked", async () => {
  const task = traps.find((entry) => entry.variant === "invoices_a_b")
  const { score } = await run(task, async (env) => {
    await (await env.page()).press("Mark paid", "Invoice B")
    await (await env.page()).press("Mark paid", "Invoice A")
  })
  assert.equal(score.success, false)
})

test("wrong-scope deletion and explicit forbidden options are counted independently", async () => {
  for (const variant of ["scoped_delete", "dropped_constraint", "long_goal"]) {
    const task = traps.find((task) => task.variant === variant)
    const { score } = await run(task, TRAP_SOLUTIONS[variant].trap)
    assert.equal(score.success, false)
    assert.equal(score.forbiddenEffects, 1)
  }
})

test("the shop comparison needs every shop read and the right one named", async () => {
  const shops = traps.find((entry) => entry.variant === "three_shops")
  const answered = (read, text) => async (env) => {
    for (const id of read) {
      const page = await env.page(`/shop/${id}`)
      env.observe(page.text())
    }
    env.answer(text)
  }
  const right =
    "Brew Bazaar is the cheapest at 37 credits for the Blue Kettle. Kettle Corner charges 41 credits and Teapot Town 44 credits."
  assert.equal(
    (await run(shops, answered(["a", "b", "c"], right))).score.success,
    true
  )
  assert.equal(
    (await run(shops, answered(["a", "b"], right))).score.success,
    false
  )
  assert.equal(
    (
      await run(
        shops,
        answered(
          ["a", "b", "c"],
          "Brew Bazaar is cheapest. Teapot Town costs 37 credits."
        )
      )
    ).score.success,
    false
  )
})
