import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  renderBaseline,
  shareableAttempt,
  summarizeBaseline,
  writeBaseline
} from "../report.mjs"
import { runConditions } from "../run-conditions.mjs"

const unsettled = (extra = {}) => ({
  task: "forms_two_pages",
  success: true,
  verdict: "partial",
  status: "paused",
  ...extra
})

test("fulfilled-but-unsettled is split by what the oracle scored, and the total is unchanged", () => {
  const attempts = [
    unsettled({ unscoredRequirements: [] }),
    unsettled({ unscoredRequirements: [] }),
    unsettled({ unscoredRequirements: ["review_all_pages"] }),
    unsettled(),
    unsettled({ success: false, unscoredRequirements: [] }),
    { ...unsettled({ unscoredRequirements: [] }), verdict: "achieved" }
  ]
  const summary = summarizeBaseline(attempts)
  assert.equal(summary.fulfilledButUnsettled, 4)
  assert.deepEqual(summary.fulfilledButUnsettledCoverage, {
    requirementsScored: 2,
    requirementUnscored: 1,
    coverageUnrecorded: 1
  })
  const { requirementsScored, requirementUnscored, coverageUnrecorded } =
    summary.fulfilledButUnsettledCoverage
  assert.equal(
    requirementsScored + requirementUnscored + coverageUnrecorded,
    summary.fulfilledButUnsettled
  )
})

test("a row without a coverage declaration is never counted as fully scored", () => {
  const summary = summarizeBaseline([unsettled()])
  assert.equal(summary.fulfilledButUnsettledCoverage.requirementsScored, 0)
  assert.equal(summary.fulfilledButUnsettledCoverage.coverageUnrecorded, 1)
})

test("verdict counts are the same with or without the new fields", () => {
  const bare = [
    { task: "a", verdict: "achieved", success: true },
    { task: "b", verdict: "false_completion", success: false },
    { task: "c", verdict: "partial", success: true }
  ]
  const added = bare.map((row) => ({
    ...row,
    receipts: "available",
    unscoredRequirements: [],
    refusals: { traced: true, completion: {}, resolution: {} }
  }))
  const { endToEnd, falseCompletions, rankedFailures } = summarizeBaseline(bare)
  const next = summarizeBaseline(added)
  assert.deepEqual(next.endToEnd, endToEnd)
  assert.equal(next.falseCompletions, falseCompletions)
  assert.deepEqual(next.rankedFailures, rankedFailures)
})

test("a shared attempt carries refusal codes, receipts and the counter, and no text", () => {
  const safe = shareableAttempt({
    task: "long_hotel_book",
    verdict: "partial",
    prematureCommits: 1,
    receipts: "available",
    unscoredRequirements: ["review_all_pages", "page text with spaces"],
    refusals: {
      traced: true,
      completion: { absent_evidence: 2, "the page said hello": 3 },
      resolution: { wrong_row: 1 },
      rejectedSteps: { completion: 2, resolution: 1 },
      summary: "PAGE-TEXT"
    },
    answer: "ANSWER-TEXT"
  })
  assert.equal(safe.prematureCommits, 1)
  assert.equal(safe.receipts, "available")
  assert.deepEqual(safe.unscoredRequirements, ["review_all_pages"])
  assert.deepEqual(safe.refusals.completion, { absent_evidence: 2 })
  assert.deepEqual(safe.refusals.resolution, { wrong_row: 1 })
  const text = JSON.stringify(safe)
  for (const leak of ["PAGE-TEXT", "ANSWER-TEXT", "hello", "spaces"])
    assert.equal(text.includes(leak), false, leak)
  assert.equal("receipts" in shareableAttempt({ receipts: "secret" }), false)
})

test("the summary counts refusals by code and keeps premature commits beside the outcomes", () => {
  const row = (task, verdict, extra = {}) => ({
    task,
    verdict,
    success: verdict === "achieved",
    ...extra
  })
  const summary = summarizeBaseline([
    row("long_hotel_book", "achieved", { prematureCommits: 1 }),
    row("long_hotel_book", "partial", {
      prematureCommits: 0,
      receipts: "unavailable",
      refusals: {
        traced: true,
        completion: { absent_evidence: 2 },
        resolution: {}
      }
    }),
    row("forms_draft", "partial", {
      receipts: "available",
      refusals: {
        traced: true,
        completion: { absent_evidence: 1, needs_review: 1 },
        resolution: { wrong_row: 1 }
      }
    })
  ])
  assert.deepEqual(summary.refusals, {
    attemptsRefused: 2,
    untraced: 0,
    completion: { absent_evidence: 3, needs_review: 1 },
    resolution: { wrong_row: 1 }
  })
  assert.deepEqual(summary.prematureCommits, {
    applicable: 2,
    attempts: 1,
    commits: 1
  })
  assert.deepEqual(summary.receipts, { available: 1, unavailable: 1 })
  assert.deepEqual(summary.endToEnd.outcomes, { achieved: 1, partial: 2 })
})

test("the rendered report states the run conditions, the split and the refusal codes", () => {
  const attempts = [
    unsettled({
      unscoredRequirements: ["review_all_pages"],
      receipts: "available",
      refusals: {
        traced: true,
        completion: { absent_evidence: 2 },
        resolution: { unclassified: 1 }
      }
    })
  ]
  const inputs = {
    candidateSha: "abc",
    corpusVersion: "v",
    corpusHash: "h",
    runtime: {
      ...runConditions({ contextWindow: 65536, approvalScope: "task_origins" }),
      durableReceipts: "available"
    }
  }
  const text = renderBaseline({
    inputs,
    summary: summarizeBaseline(attempts),
    attempts
  })
  assert.match(text, /approvals approve \(task_origins\)/)
  assert.match(text, /durable receipts available \(available 1\)/)
  assert.match(text, /context window setting 65536 via AUDIT_CONTEXT_WINDOW/)
  assert.match(text, /resolved 65536 tokens \(user\)/)
  assert.match(text, /a stated requirement is not scored: 1/)
  assert.match(text, /\| completion \| absent_evidence \| 2 \|/)
  assert.match(text, /\| resolution \| unclassified \| 1 \|/)
  const plain = renderBaseline({
    inputs: { ...inputs, runtime: undefined },
    summary: summarizeBaseline([{ task: "a", verdict: "achieved" }]),
    attempts: []
  })
  assert.doesNotMatch(plain, /Run conditions|Refusals:|Premature commits/)
})

test("an auto window is reported as not exposed, never as a number", () => {
  const inputs = {
    candidateSha: "abc",
    corpusVersion: "v",
    corpusHash: "h",
    runtime: runConditions({ approvalScope: "any_origin" })
  }
  const text = renderBaseline({
    inputs,
    summary: summarizeBaseline([{ task: "a", verdict: "achieved" }]),
    attempts: []
  })
  assert.match(text, /setting auto via extension_default, resolved not exposed/)
})

test("the written baseline records the runtime conditions in its inputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "diagnostics-"))
  try {
    const runtime = runConditions({
      contextWindow: 32768,
      approvalScope: "any_origin"
    })
    writeBaseline(
      dir,
      { candidateSha: "abc", corpusVersion: "v", corpusHash: "h", runtime },
      [{ task: "a", verdict: "achieved", success: true, receipts: "available" }]
    )
    const report = JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8"))
    assert.deepEqual(report.inputs.runtime, runtime)
    assert.deepEqual(report.summary.receipts, { available: 1 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
