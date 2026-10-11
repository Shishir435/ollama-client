import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
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

test("promotion is evidence-driven when prices and matched manual intervention measurements exist", () => {
  const reports = [report("one"), report("two")]
  for (const current of reports) {
    current.inputs.interventionMeasurement = "manual"
    for (const row of current.attempts) {
      row.costUsd = 0.01
      row.humanInterventions = 0
    }
  }
  const baselines = structuredClone(reports)
  for (const prior of baselines)
    for (const row of prior.attempts) row.humanInterventions = 1
  const result = evaluateRelease(reports, candidate, {
    costBudgetUsd: 0.02,
    baselineReports: baselines
  })
  assert.equal(result.promotionReady, true)
  assert.deepEqual(result.blockers, [])
  reports[0].attempts[0].costUsd = 0.03
  assert.equal(
    evaluateRelease(reports, candidate, {
      costBudgetUsd: 0.02,
      baselineReports: baselines
    }).promotionReady,
    false
  )
})

test("a failed candidate attempt never counts as fewer interventions", () => {
  const reports = [report("one"), report("two")]
  for (const current of reports) {
    current.inputs.interventionMeasurement = "manual"
    for (const row of current.attempts) {
      row.costUsd = 0.01
      row.humanInterventions = 1
    }
  }
  const baselines = structuredClone(reports)
  reports[0].attempts[0].success = false
  reports[0].attempts[0].humanInterventions = 0
  const result = evaluateRelease(reports, candidate, {
    costBudgetUsd: 0.02,
    baselineReports: baselines
  })
  assert.ok(
    result.blockers.includes("matched_intervention_improvement_not_qualified")
  )
})

test("the release command passes its budget and baselines to the gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-gate-"))
  try {
    const reports = [report("one"), report("two")]
    for (const current of reports) {
      current.inputs.interventionMeasurement = "manual"
      for (const row of current.attempts) {
        row.costUsd = 0.01
        row.humanInterventions = 0
      }
    }
    const baselines = structuredClone(reports)
    for (const prior of baselines)
      for (const row of prior.attempts) row.humanInterventions = 1
    const write = (name, value) => {
      const path = join(dir, name)
      writeFileSync(path, JSON.stringify(value))
      return path
    }
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../release.mjs", import.meta.url)),
        candidate,
        "--budget",
        "0.02",
        "--baseline",
        write("b1.json", baselines[0]),
        "--baseline",
        write("b2.json", baselines[1]),
        write("q1.json", reports[0]),
        write("q2.json", reports[1])
      ],
      { encoding: "utf8" }
    )
    assert.equal(run.status, 0, run.stderr)
    assert.equal(JSON.parse(run.stdout).promotionReady, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the release command refuses an empty budget instead of reading it as zero", () => {
  const run = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../release.mjs", import.meta.url)),
      candidate,
      "--budget",
      " ",
      "a.json",
      "b.json"
    ],
    { encoding: "utf8" }
  )
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /--budget takes a non-negative US dollar amount/)
})
