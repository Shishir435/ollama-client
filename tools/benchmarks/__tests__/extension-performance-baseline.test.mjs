import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildPerformanceBaseline,
  compareWithBaseline,
  extractPerformanceReports,
  median,
  parsePerformanceBaseline
} from "../extension-performance-baseline.ts"

const makeReport = (runId, offset = 0) => ({
  schemaVersion: 1,
  measuredAt: `2026-10-${String((Number(runId) % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  browser: {
    major: "140",
    project: "chromium-production",
    userAgent: "Chrome/140.0"
  },
  runner: {
    arch: "X64",
    commitSha: `sha-${runId}`,
    nodeMajor: "22",
    os: "Linux",
    workflowRunId: runId
  },
  sampleCount: 3,
  metrics: {
    firstContentfulPaintMs: 180 + offset,
    appMountMs: 130 + offset,
    chatTimeToFirstTokenMs: 90 + offset,
    chatCompletionMs: 140 + offset
  },
  samples: [{}, {}, {}]
})

test("calculates a median for an odd or even sample count", () => {
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([1, 3, 5, 7]), 4)
})

test("keeps measurements report-only until a baseline is supplied", () => {
  assert.deepEqual(compareWithBaseline(makeReport("1"), null), {
    mode: "report-only",
    notes: ["No committed CI baseline yet; collecting reports."],
    failures: []
  })
})

test("builds a robust baseline from 20 distinct CI runs", () => {
  const baseline = buildPerformanceBaseline(
    Array.from({ length: 20 }, (_, index) =>
      makeReport(String(index + 1), index % 3)
    ),
    "2026-10-25T00:00:00.000Z"
  )
  assert.equal(baseline.sourceRunCount, 20)
  assert.equal(baseline.metrics.firstContentfulPaintMs.medianMs, 181)
  assert.equal(baseline.environment.runnerOS, "Linux")
})

test("deduplicates repeated artifacts from one CI run", () => {
  assert.throws(
    () =>
      buildPerformanceBaseline(
        Array.from({ length: 20 }, () => makeReport("same"))
      ),
    /Need 20 distinct CI runs; found 1/
  )
})

test("fails only when a metric exceeds the robust baseline allowance", () => {
  const baseline = buildPerformanceBaseline(
    Array.from({ length: 20 }, () => makeReport("1")).map((report, index) => ({
      ...report,
      runner: { ...report.runner, workflowRunId: String(index + 1) }
    }))
  )
  const normal = makeReport("current")
  assert.equal(compareWithBaseline(normal, baseline).failures.length, 0)
  const slow = {
    ...normal,
    metrics: { ...normal.metrics, appMountMs: 300 }
  }
  assert.deepEqual(compareWithBaseline(slow, baseline).failures, [
    "appMountMs 300.0ms exceeds 156.0ms baseline limit"
  ])
})

test("extracts reports from Playwright JSON annotations", () => {
  const report = makeReport("42")
  const parsed = extractPerformanceReports({
    suites: [
      {
        specs: [
          {
            tests: [
              {
                results: [
                  {
                    annotations: [
                      {
                        type: "extension-performance",
                        description: JSON.stringify(report)
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  })
  assert.deepEqual(parsed, [report])
})

test("rejects a baseline that could silently disable the gate", () => {
  assert.throws(
    () => parsePerformanceBaseline({ schemaVersion: 1 }),
    /incomplete/
  )
})
