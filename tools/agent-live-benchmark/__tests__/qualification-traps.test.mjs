import assert from "node:assert/strict"
import { describe, it, test } from "node:test"
import { JSDOM, VirtualConsole } from "jsdom"
import { TRAP_SOLUTIONS } from "../qualification-cheats.mjs"
import {
  QUALIFICATION_TASKS,
  selectQualificationTasks
} from "../qualification-corpus.mjs"
import { injectQualificationFault } from "../qualification-faults.mjs"
import {
  createQualificationState,
  qualificationHtml,
  recordQualificationRequest
} from "../qualification-fixtures.mjs"
import { summarizeQualification } from "../qualification-report.mjs"
import { scoreQualification } from "../qualification-score.mjs"
import { TRAP_HELD_OUT, TRAP_VARIANTS } from "../qualification-traps.mjs"

const ORIGIN = "http://127.0.0.1:4100"
const traps = QUALIFICATION_TASKS.filter((task) => task.family === "traps")
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0))
}

/**
 * A fixture server and a page driver over JSDOM. Every request a page's
 * script sends goes through the same `recordQualificationRequest` the live
 * harness serves, so the state the scorer reads is the state the page made.
 */
const harness = (task) => {
  let clock = 1_000
  const state = createQualificationState(task)
  state.now = () => clock
  const base = `/q/${task.id}`
  const input = {
    state,
    path: `${base}/result`,
    body: "",
    answer: "",
    observedText: "",
    pages: [],
    status: "completed",
    wire: []
  }
  const doms = []
  const env = {
    page: async (path = "") => {
      const url = `${ORIGIN}${base}${path}`
      recordQualificationRequest(state, `${base}${path}`)
      const dom = new JSDOM(qualificationHtml(state, `${base}${path}`), {
        url,
        runScripts: "dangerously",
        /** Pages navigate after saving; JSDOM can't, and says so on stderr. */
        virtualConsole: new VirtualConsole(),
        beforeParse(window) {
          window.fetch = async (target, options = {}) => {
            const answer = recordQualificationRequest(
              state,
              new URL(target, url).pathname,
              options.body ?? "",
              false,
              options.method ?? "GET"
            )
            const status = answer?.status ?? 200
            return {
              ok: status < 400,
              status,
              json: async () => JSON.parse(answer?.body ?? "{}"),
              text: async () => answer?.body ?? "ok"
            }
          }
        }
      })
      doms.push(dom)
      await settle()
      const document = dom.window.document
      const scope = (section) =>
        section
          ? [...document.querySelectorAll("section")].find(
              (node) => node.querySelector("h2")?.textContent === section
            )
          : document
      return {
        fill: (id, value) => {
          document.getElementById(id).value = value
        },
        choose: (id, value) => {
          document.getElementById(id).value = value
        },
        toggle: async (id) => {
          document.getElementById(id).click()
          await settle()
        },
        press: async (text, section) => {
          const target = [
            ...scope(section).querySelectorAll("button, a, [role=switch]")
          ].find((node) => node.textContent.trim() === text)
          assert.ok(target, `no control "${text}" in ${section ?? "page"}`)
          target.click()
          await settle()
        },
        /** Element text kept apart, as a run's observation keeps it. */
        text: () => {
          const walker = document.createTreeWalker(
            document.querySelector("main"),
            dom.window.NodeFilter.SHOW_TEXT
          )
          const parts = []
          while (walker.nextNode())
            if (walker.currentNode.parentElement?.tagName !== "SCRIPT")
              parts.push(walker.currentNode.nodeValue)
          return parts.join(" ")
        },
        element: (selector) => document.querySelector(selector)
      }
    },
    answer: (text) => {
      input.answer = text
    },
    observe: (text) => {
      input.observedText += `\n${text}`
    },
    advance: (ms) => {
      clock += ms
    },
    restartWorker: () =>
      injectQualificationFault(
        state,
        undefined,
        { tools: [{ function: { name: "agent_decision" } }] },
        { restartWorker: async () => {} }
      )
  }
  const close = () => {
    for (const dom of doms) dom.window.close()
  }
  return { env, input, close }
}

const run = async (task, script) => {
  const { env, input, close } = harness(task)
  try {
    await script?.(env, task)
    return { input, score: scoreQualification(input) }
  } finally {
    close()
  }
}

test("fifteen traps, a third held out, each with a solution and a named mistake", () => {
  assert.equal(traps.length, 15)
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
  assert.equal(selectQualificationTasks("development").length, 50)
  assert.equal(selectQualificationTasks("held_out").length, 25)
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
    "The Blue Kettle costs 37 credits; so does the Navy Kettle at 37."
  ]) {
    const { score } = await run(kettles, answered(wrong))
    assert.equal(score.success, false, wrong)
  }
  const plans = traps.find((entry) => entry.variant === "irrelevant_quote")
  const { score } = await run(plans, async (env) => {
    await TRAP_SOLUTIONS.irrelevant_quote.cheat(env)
    env.answer("The cheapest is Starter at 12 credits; Basic is next.")
  })
  assert.equal(score.success, false)
})

test("the two invoices must be paid in the order asked", async () => {
  const task = traps.find((entry) => entry.variant === "invoices_a_b")
  const { score } = await run(task, async (env) => {
    await (await env.page()).press("Mark paid", "Invoice B")
    await (await env.page()).press("Mark paid", "Invoice A")
  })
  assert.equal(score.success, false)
})
