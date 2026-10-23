import assert from "node:assert/strict"
import { test } from "node:test"
import {
  attemptTimedOut,
  HarnessDeadlineError,
  providerRefusal,
  settleTeardown,
  taskTimeoutFromEnv,
  withDeadline
} from "../attempt-deadline.mjs"
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

test("a hung setup step is cut off with its own failure code", async () => {
  await assert.rejects(
    withDeadline("setup", "load", 20, () => new Promise(() => {})),
    (error) =>
      error instanceof HarnessDeadlineError &&
      error.failureCode === "harness_setup_timeout"
  )
  assert.equal(await withDeadline("setup", "ok", 1000, async () => 7), 7)
})

test("a hung teardown step never blocks or fails the suite", async () => {
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    await settleTeardown("close", () => new Promise(() => {}), 20)
  } finally {
    console.warn = originalWarn
  }
})

test("a provider that only refuses fails the attempt fast, an injected fault does not", () => {
  const chat = (status, extra = {}) => ({
    path: "/v1/chat/completions",
    status,
    started: 0,
    ...extra
  })
  assert.equal(providerRefusal([chat(403)], 1), "provider_refused")
  assert.equal(providerRefusal([chat(401)], 1), "provider_refused")
  assert.equal(providerRefusal([chat(403), chat(200)], 1), undefined)
  assert.equal(providerRefusal([chat(503, { injected: true })], 1), undefined)
  assert.equal(providerRefusal([chat(429)], 1_000), undefined)
  assert.equal(
    providerRefusal([chat(429)], 4 * 60_000),
    "provider_rate_limited"
  )
  assert.equal(providerRefusal([], 1), undefined)
})

test("an injected fault is not the provider's failure", () => {
  const verdict = classifyAttempt({
    status: "completed",
    success: true,
    providerFailure: false
  })
  assert.equal(verdict, "achieved")
})
