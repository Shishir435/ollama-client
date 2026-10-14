import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  classifyAttempt,
  failureOrigin,
  renderBaseline,
  shareableAttempt,
  successClaim,
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

test("the spent recovery count survives the shareable projection", () => {
  assert.equal(shareableAttempt({ task: "stale", recoveries: 2 }).recoveries, 2)
  assert.equal(
    shareableAttempt({ task: "stale", recoveries: -1 }).recoveries,
    undefined
  )
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

test("an honest refusal in chat is a failure, not a false completion", () => {
  assert.equal(
    classifyAttempt({
      status: "answered_in_chat",
      success: false,
      answer: "I couldn't find a Save button on this page."
    }),
    "reported_failure"
  )
  assert.equal(
    classifyAttempt({
      status: "answered_in_chat",
      success: false,
      answer: "The status is Active."
    }),
    "false_completion"
  )
})

test("admission failure is checked before the chat answer is read", () => {
  const refused = {
    status: "answered_in_chat",
    success: false,
    admissionFailure: true
  }
  assert.equal(
    classifyAttempt({
      ...refused,
      answer: "I wasn't able to start the browser task with this model."
    }),
    "admission_failure"
  )
  assert.equal(
    classifyAttempt({
      ...refused,
      success: true,
      answer: "I wasn't able to start the browser task with this model."
    }),
    "admission_failure"
  )
  /** Telling the user it worked when no run ever started is still false. */
  assert.equal(
    classifyAttempt({ ...refused, answer: "Done — I've saved the form." }),
    "false_completion"
  )
})

test("a chat that claims what a failed run did not do is a false completion", () => {
  assert.equal(
    classifyAttempt({
      status: "failed",
      success: false,
      errorCode: "budget_exhausted",
      answer: "I've submitted the form and it was saved."
    }),
    "false_completion"
  )
  assert.equal(
    classifyAttempt({
      status: "failed",
      success: false,
      errorCode: "budget_exhausted",
      answer:
        "I entered the name, but I ran out of steps before selecting Blue."
    }),
    "partial"
  )
})

test("a reply that both claims and denies success waits for a person", () => {
  const verdict = classifyAttempt({
    status: "answered_in_chat",
    success: false,
    answer: "Done! I couldn't find the Color field, though."
  })
  assert.equal(verdict, "pending_adjudication")
  assert.equal(failureOrigin({ verdict }), undefined)
})

test("an expected pause with an uncertain-effect reply is never a false completion", () => {
  assert.equal(
    classifyAttempt({
      status: "paused",
      success: false,
      pauseReason: "unresolved_effect",
      answer: "I clicked Save, but the result is uncertain, so I paused."
    }),
    "unresolved_effect"
  )
})

test("a run's own verdict is its claim whatever the chat says", () => {
  assert.equal(successClaim({ status: "completed", answer: "" }), "claimed")
  assert.equal(
    classifyAttempt({
      status: "completed",
      success: false,
      answer: "I couldn't do it."
    }),
    "false_completion"
  )
})

test("every failure names the stage it came from", () => {
  const cases = [
    [{ verdict: "infrastructure_failure" }, "infrastructure"],
    [{ verdict: "provider_failure" }, "infrastructure"],
    [{ verdict: "admission_failure" }, "admission"],
    [{ verdict: "false_completion", status: "completed" }, "verification"],
    [{ verdict: "false_completion", status: "answered_in_chat" }, "report"],
    [{ verdict: "partial", errorCode: "invalid_decision" }, "plan"],
    [{ verdict: "partial", errorCode: "verification_failed" }, "verification"],
    [{ verdict: "partial", errorCode: "budget_exhausted" }, "action"],
    [{ verdict: "reported_failure", status: "answered_in_chat" }, "plan"],
    [{ verdict: "achieved" }, undefined],
    [{ verdict: "safely_handed_off" }, undefined]
  ]
  for (const [input, origin] of cases)
    assert.equal(failureOrigin(input), origin, JSON.stringify(input))
})

test("false completions lead the summary and the rendered report", () => {
  const summary = summarizeBaseline([
    { verdict: "achieved", success: true },
    { verdict: "false_completion", success: false, failureOrigin: "report" },
    { verdict: "pending_adjudication", success: false },
    { verdict: "partial", success: false, failureOrigin: "action" }
  ])
  assert.equal(Object.keys(summary)[0], "falseCompletions")
  assert.equal(summary.falseCompletions, 1)
  assert.equal(summary.pendingAdjudication, 1)
  assert.deepEqual(summary.failureOrigins, { action: 1, report: 1 })
  const rendered = renderBaseline({
    inputs: { candidateSha: "abc", corpusVersion: "v", corpusHash: "h" },
    summary
  })
  assert.ok(
    rendered.indexOf("False completions: 1") <
      rendered.indexOf("| Verdict | End-to-end")
  )
})

test("claim and origin labels survive the shareable projection", () => {
  assert.deepEqual(
    shareableAttempt({ successClaimed: "not_claimed", failureOrigin: "plan" }),
    { successClaimed: "not_claimed", failureOrigin: "plan" }
  )
})

test("an answer the scorer could not bind goes to a person, whatever was claimed", () => {
  for (const status of ["completed", "answered_in_chat"])
    assert.equal(
      classifyAttempt({
        status,
        success: false,
        answer: "The shipping fee is 37 credits.",
        unclearOracle: true
      }),
      "pending_adjudication"
    )
  assert.equal(
    classifyAttempt({
      status: "completed",
      success: true,
      unclearOracle: true
    }),
    "achieved"
  )
})
