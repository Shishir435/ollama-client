import assert from "node:assert/strict"
import { test } from "node:test"
import { attemptTimedOut, taskTimeoutFromEnv } from "../attempt-deadline.mjs"
import { classifyAttempt, summarizeBaseline } from "../report.mjs"

test("an expired active run is void even when its oracle passed", () => {
  for (const status of [
    "deciding",
    "executing",
    "verifying",
    "awaiting_approval",
    "harness_timeout"
  ]) {
    const infrastructureFailure = attemptTimedOut({
      status,
      deadlineReached: true
    })
    assert.equal(infrastructureFailure, true)
    const verdict = classifyAttempt({
      status,
      success: true,
      infrastructureFailure
    })
    assert.equal(verdict, "infrastructure_failure")
    assert.equal(summarizeBaseline([{ verdict }]).endToEnd.denominator, 1)
  }
})

test("settled runs and finished chat answers remain valid at the deadline", () => {
  for (const status of [
    "completed",
    "partial",
    "failed",
    "paused",
    "awaiting_takeover",
    "cancelled",
    "answered_in_chat"
  ])
    assert.equal(attemptTimedOut({ status, deadlineReached: true }), false)
  assert.equal(attemptTimedOut({ status: "deciding" }), false)
})

test("the harness deadline is pinned and rejects malformed overrides", () => {
  assert.equal(taskTimeoutFromEnv({}), 45 * 60_000)
  assert.equal(taskTimeoutFromEnv({ AUDIT_TASK_TIMEOUT_MS: "150000" }), 150000)
  for (const value of ["", " ", "0", "-1", "1.5", "no", "Infinity"])
    assert.throws(() => taskTimeoutFromEnv({ AUDIT_TASK_TIMEOUT_MS: value }))
})
