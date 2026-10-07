import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  classifyAttempt,
  renderBaseline,
  shareableAttempt,
  summarizeBaseline,
  supervisionTelemetry,
  wireTelemetry,
  writeBaseline
} from "../report.mjs"
import { scoreSyntheticGoal, scoreSyntheticTask } from "../score-answer.mjs"

test("independent correctness never turns interrupted or uncertain effects into completion", () => {
  assert.equal(
    classifyAttempt({ status: "completed", success: false }),
    "false_completion"
  )
  assert.equal(
    classifyAttempt({ status: "cancelled", success: true }),
    "partial"
  )
  assert.equal(
    classifyAttempt({
      status: "paused",
      success: true,
      pauseReason: "unresolved_effect"
    }),
    "unresolved_effect"
  )
  assert.equal(classifyAttempt({ status: "partial", success: true }), "partial")
  assert.equal(
    classifyAttempt({
      status: "paused",
      expectedStatus: "paused",
      success: true
    }),
    "safely_handed_off"
  )
  assert.equal(
    classifyAttempt({
      status: "paused",
      expectedPause: true,
      pauseReason: "unresolved_effect",
      success: true
    }),
    "safely_handed_off"
  )
  assert.equal(
    classifyAttempt({
      status: "paused",
      expectedPause: true,
      pauseReason: "unresolved_effect",
      success: false
    }),
    "unresolved_effect"
  )
  assert.equal(
    classifyAttempt({ status: "failed", errorCode: "model_unavailable" }),
    "provider_failure"
  )
  assert.equal(classifyAttempt({ status: "not-started" }), "admission_failure")
  assert.equal(
    classifyAttempt({
      status: "harness_exception",
      infrastructureFailure: true
    }),
    "infrastructure_failure"
  )
  assert.equal(
    classifyAttempt({ status: "failed", siteBlocked: true }),
    "site_blockage"
  )
  assert.equal(
    classifyAttempt({ status: "completed", success: false, siteBlocked: true }),
    "false_completion"
  )
})

test("both denominators include admission/provider/site failures; only infrastructure is excluded from qualified", () => {
  const attempts = [
    "achieved",
    "admission_failure",
    "provider_failure",
    "site_blockage",
    "infrastructure_failure",
    "partial",
    "partial"
  ].map((verdict) => ({ verdict, success: verdict === "partial" }))
  const summary = summarizeBaseline(attempts)
  assert.equal(summary.endToEnd.denominator, 7)
  assert.equal(summary.infrastructureQualified.denominator, 6)
  assert.equal(summary.fulfilledButUnsettled, 2)
  assert.deepEqual(summary.rankedFailures[0], {
    failure: "partial/partial",
    count: 2
  })
})

test("shareable outcomes cannot contain page text, URLs, wire or arbitrary error messages", () => {
  const safe = shareableAttempt({
    task: "read",
    attempt: 1,
    status: "completed",
    verdict: "false_completion",
    answer: "secret",
    body: "private",
    url: "https://secret.test",
    reason: "private reason",
    errorCode: "https://private.test?q=secret",
    steps: Infinity,
    executionStages: ["read_tab", "secret words"],
    wire: [{ request: "secret" }]
  })
  assert.deepEqual(safe, {
    task: "read",
    status: "completed",
    verdict: "false_completion",
    attempt: 1,
    executionStages: ["read_tab"]
  })
})

test("canvas screenshot proof survives the shareable projection without image bytes", () => {
  for (const renderedCanvasScreenshot of [true, false])
    assert.deepEqual(
      shareableAttempt({ renderedCanvasScreenshot, image: "private-bytes" }),
      { renderedCanvasScreenshot }
    )
  assert.deepEqual(
    shareableAttempt({ renderedCanvasScreenshot: "private-bytes" }),
    {}
  )
})

test("saved rows regenerate the report with no hand-maintained summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "baseline-report-"))
  try {
    const inputs = {
      candidateSha: "abc",
      corpusVersion: "v1",
      corpusHash: "123"
    }
    writeBaseline(dir, inputs, [
      { task: "read", verdict: "partial", success: true },
      { task: "click", verdict: "infrastructure_failure" }
    ])
    const saved = JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8"))
    const recomputed = { ...saved, summary: summarizeBaseline(saved.attempts) }
    assert.equal(
      renderBaseline(recomputed),
      readFileSync(join(dir, "baseline.md"), "utf8")
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("wire counts planning and execution separately and keeps unknown usage absent", () => {
  const request = (name, messages = []) => ({
    path: "/v1/chat/completions",
    request: { tools: [{ function: { name } }], messages }
  })
  const rows = [
    request("browser_task", [
      { tool_calls: [{ function: { name: "read_tab" } }] }
    ]),
    request("agent_plan"),
    request("agent_decision")
  ]
  assert.deepEqual(wireTelemetry(rows), {
    modelCalls: 3,
    planningCalls: 1,
    runtimeCalls: 1,
    chatCalls: 1,
    executionStages: [
      "direct_chat",
      "read_tab",
      "planning",
      "runtime_execution"
    ]
  })
  rows[2].response =
    'data: {"usage":{"prompt_tokens":123,"completion_tokens":45}}\n\n'
  assert.equal(wireTelemetry(rows).promptTokens, 123)
})

test("approval duplicates count once and attention time is separate from active time", () => {
  const approval = {
    at: 20,
    snapshot: {
      run: { status: "awaiting_approval" },
      pending: { kind: "approval", request: { id: "a" } }
    }
  }
  const stats = supervisionTelemetry(
    [
      approval,
      { ...approval, at: 30 },
      { at: 60, snapshot: { run: { status: "deciding" } } }
    ],
    0,
    100
  )
  assert.equal(stats.approvalsAsked, 1)
  assert.equal(stats.humanWaitMs, 40)
  assert.equal(stats.activeMs, 60)
})

test("a fulfilled checkbox remains distinguishable from a settled completion", () => {
  const input = { kind: "checkbox", completed: false, field: { checked: true } }
  assert.equal(scoreSyntheticTask(input).success, false)
  const goal = scoreSyntheticGoal(input)
  assert.equal(goal.success, true)
  const verdict = classifyAttempt({ status: "partial", success: goal.success })
  assert.equal(verdict, "partial")
  assert.equal(
    summarizeBaseline([{ verdict, success: goal.success }])
      .fulfilledButUnsettled,
    1
  )
})
