/**
 * A fixture server and page driver over JSDOM, shared by the trap and long
 * task tests. Not a test file: the runner's glob is `*.test.mjs`.
 */
import assert from "node:assert/strict"
import { JSDOM, VirtualConsole } from "jsdom"
import { injectQualificationFault } from "../qualification-faults.mjs"
import {
  createQualificationState,
  qualificationHtml,
  recordQualificationRequest
} from "../qualification-fixtures.mjs"
import { scoreQualification } from "../qualification-score.mjs"

const ORIGIN = "http://127.0.0.1:4100"
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0))
}

/**
 * A fixture server and a page driver over JSDOM. Every request a page's
 * script sends goes through the same `recordQualificationRequest` the live
 * harness serves, so the state the scorer reads is the state the page made.
 */
export const harness = (task) => {
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

export const run = async (task, script) => {
  const { env, input, close } = harness(task)
  try {
    await script?.(env, task)
    return { input, score: scoreQualification(input) }
  } finally {
    close()
  }
}
