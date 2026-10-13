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
import { writeBaseline } from "../report.mjs"
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
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
