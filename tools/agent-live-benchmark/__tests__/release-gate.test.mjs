import assert from "node:assert/strict"
import { test } from "node:test"
import {
  QUALIFICATION_TASKS,
  QUALIFICATION_VERSION
} from "../qualification-corpus.mjs"
import { evaluateRelease } from "../release-gate.mjs"

const candidate = "a".repeat(40)
const report = (model) => ({
  inputs: {
    candidateSha: candidate,
    artifactHash: "built",
    corpusHash: "frozen",
    executionKind: "live_model",
    model,
    budgets: { attempts: 3 },
    qualification: {
      version: QUALIFICATION_VERSION,
      taskIds: QUALIFICATION_TASKS.map((task) => task.id),
      requestSettings: [{ phase: "decision", model }]
    }
  },
  attempts: QUALIFICATION_TASKS.flatMap((task) =>
    Array.from({ length: 3 }, (_, i) => ({
      task: task.id,
      attempt: i + 1,
      split: task.split,
      family: task.family,
      success: true,
      verdict: "achieved",
      activeMs: (i + 1) * 100,
      faultInjected: task.family === "lifecycle"
    }))
  )
})

test("complete live evidence retains preview until cost and matched intervention evidence exists", () => {
  const result = evaluateRelease([report("one"), report("two")], candidate)
  assert.equal(result.matrix.qualificationEvidenceComplete, true)
  assert.equal(result.promotionReady, false)
  assert.deepEqual(result.blockers, [
    "cost_budget_not_qualified",
    "matched_intervention_improvement_not_qualified"
  ])
  assert.deepEqual(result.configurations[0].activeMs, { p50: 200, p95: 300 })
})

test("held-out failures cannot hide behind development success or infrastructure exclusion", () => {
  const sample = report("one")
  for (const row of sample.attempts
    .filter((row) => row.split === "held_out")
    .slice(0, 7)) {
    row.success = false
    row.verdict = "infrastructure_failure"
  }
  const result = evaluateRelease([sample, report("two")], candidate)
  assert.equal(result.configurations[0].attempted, 180)
  assert.ok(result.blockers.includes("held_out_below_target"))
  assert.ok(result.blockers.includes("incomplete_or_unsafe_two_model_evidence"))
})

test("exact candidate, independent success and complete timing are mandatory", () => {
  const sample = report("one")
  sample.attempts.forEach((row) => {
    delete row.success
  })
  delete sample.attempts[0].activeMs
  const result = evaluateRelease([sample, report("two")], "b".repeat(40))
  assert.ok(result.blockers.includes("wrong_release_candidate"))
  assert.ok(result.blockers.includes("correct_outcomes_below_target"))
  assert.ok(result.blockers.includes("missing_active_latency"))
})

test("a failed safety case blocks qualification even above the correctness target", () => {
  const sample = report("one")
  const row = sample.attempts.find((entry) => entry.family === "lifecycle")
  row.success = false
  row.verdict = "partial"
  const result = evaluateRelease([sample, report("two")], candidate)
  assert.ok(result.configurations[0].rate > 0.9)
  assert.ok(result.blockers.includes("adversarial_or_fault_case_failed"))
})
