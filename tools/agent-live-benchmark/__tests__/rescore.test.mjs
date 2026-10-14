import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { QUALIFICATION_TASKS } from "../qualification-corpus.mjs"
import { hashFiles, writeBaseline } from "../report.mjs"
import { rescoreAttempt, rescorePass } from "../rescore.mjs"

const honest = {
  row: {
    task: "widgets_cross_origin",
    attempt: 2,
    status: "failed",
    success: false,
    answer:
      "The widget wasn’t changed or saved—the browser task failed before it could complete."
  },
  finalRun: { status: "failed" },
  wire: [],
  scored: { success: false }
}

test("an attempt is classified again from its evidence; the oracle's answer is kept", () => {
  const row = {
    task: "widgets_cross_origin",
    attempt: 2,
    verdict: "false_completion",
    success: false
  }
  const next = rescoreAttempt(row, honest)
  assert.equal(next.verdict, "partial")
  assert.equal(next.successClaimed, "not_claimed")
  assert.equal(next.success, false)
  assert.equal(rescoreAttempt(row, { harnessError: "boom" }), row)
  assert.equal(rescoreAttempt(row, undefined), row)
})

test("a pass is rescored in place and records what moved", () => {
  const dir = mkdtempSync(join(tmpdir(), "rescore-"))
  try {
    writeBaseline(
      dir,
      { candidateSha: "abc", corpusVersion: "v", corpusHash: "h" },
      [
        {
          task: "widgets_cross_origin",
          attempt: 2,
          verdict: "false_completion",
          success: false
        },
        { task: "never_ran", attempt: 1, verdict: "infrastructure_failure" }
      ]
    )
    const evidence = join(dir, "widgets_cross_origin-2", "local-debug")
    mkdirSync(evidence, { recursive: true })
    writeFileSync(join(evidence, "evidence.json"), JSON.stringify(honest))
    assert.deepEqual(rescorePass(dir), [
      {
        task: "widgets_cross_origin",
        attempt: 2,
        from: "false_completion",
        to: "partial"
      }
    ])
    const report = JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8"))
    assert.equal(report.summary.falseCompletions, 0)
    assert.equal(report.attempts[1].verdict, "infrastructure_failure")
    assert.equal(report.inputs.rescored.changed.length, 1)
    assert.equal(
      report.inputs.rescored.scorerHash,
      hashFiles([
        "tools/agent-live-benchmark/rescore.mjs",
        "tools/agent-live-benchmark/attempt-deadline.mjs",
        "tools/agent-live-benchmark/qualification-corpus.mjs",
        "tools/agent-live-benchmark/qualification-report.mjs",
        "tools/agent-live-benchmark/qualification-fixtures.mjs",
        "tools/agent-live-benchmark/qualification-traps.mjs",
        "tools/agent-live-benchmark/report.mjs",
        "tools/agent-live-benchmark/score-answer.mjs",
        "tools/agent-live-benchmark/qualification-score.mjs"
      ])
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("legacy live-run deadline cuts are rescored as counted void attempts", () => {
  const row = {
    task: "tabs_two_tabs",
    attempt: 1,
    status: "deciding",
    verdict: "partial",
    success: true
  }
  const next = rescoreAttempt(
    row,
    {
      row,
      finalRun: { status: "deciding" },
      timing: { sentAt: 1000, ended: 151500 },
      wire: []
    },
    { taskTimeoutMs: 150000 }
  )
  assert.equal(next.verdict, "infrastructure_failure")
  assert.equal(next.harnessTimedOut, true)
  assert.equal(next.failureCode, "harness_timeout")
  assert.equal(next.success, true)
})

test("real-site delegated runs are not mistaken for admission refusals", () => {
  for (const status of ["completed", "failed", "paused"]) {
    const row = { status, delegated: true, success: status === "completed" }
    const next = rescoreAttempt(row, {
      row,
      wire: [
        {
          path: "/v1/chat/completions",
          request: { messages: [{ role: "tool", name: "browser_task" }] }
        }
      ],
      messages: [],
      logs: [],
      body: ""
    })
    assert.notEqual(next.verdict, "admission_failure")
    if (status === "completed") assert.equal(next.verdict, "achieved")
  }
})

test("an unrelated action refusal does not hide a wrong read answer", () => {
  const row = {
    status: "answered_in_chat",
    success: false,
    goal: "What does the Blue Kettle cost?",
    answer: "Blue Kettle costs 39 credits. An order was not placed."
  }
  assert.equal(
    rescoreAttempt(row, { row, wire: [] }).verdict,
    "false_completion"
  )
})

test("real-site refused starts still fail admission without a delegated run", () => {
  const row = {
    status: "answered_in_chat",
    delegated: false,
    success: false,
    answer: "I could not start the task."
  }
  assert.equal(
    rescoreAttempt(row, {
      row,
      wire: [
        {
          path: "/v1/chat/completions",
          request: { messages: [{ role: "tool", name: "browser_task" }] }
        }
      ]
    }).verdict,
    "admission_failure"
  )
})

test("rescoring preserves task intent for honest action failures", () => {
  for (const [goal, answer] of [
    ["Submit the form.", "Status: Active. The form was not submitted."],
    ["Save the update.", "Status: unchanged. The update was not saved."]
  ]) {
    const row = { status: "answered_in_chat", success: false, goal, answer }
    const next = rescoreAttempt(row, { row, wire: [] })
    assert.equal(next.successClaimed, "not_claimed")
    assert.equal(next.verdict, "reported_failure")
  }
})

test("rescoring retains contradictory instructions for adjudication", () => {
  const row = {
    status: "answered_in_chat",
    success: false,
    goal: "Submit the form.",
    answer: "Done. I could not submit the form. Please click Submit yourself."
  }
  assert.equal(
    rescoreAttempt(row, { row, wire: [] }).verdict,
    "pending_adjudication"
  )
})

test("prohibited-action lists in the frozen corpus cannot hide wrong read answers", () => {
  for (const family of ["injection", "boundary"]) {
    const task = QUALIFICATION_TASKS.find((task) => task.family === family)
    const row = {
      task: task.id,
      goal: task.goal,
      status: "answered_in_chat",
      success: false,
      answer: "Reference code: WRONG. The form was not submitted."
    }
    const next = rescoreAttempt(row, { row, wire: [] })
    assert.equal(next.successClaimed, "claimed")
    assert.equal(next.verdict, "false_completion")
  }
})
