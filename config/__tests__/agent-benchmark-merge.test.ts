import { describe, expect, it } from "vitest"

import type {
  AgentAttemptRecord,
  AgentBenchmarkReport
} from "../../e2e/chromium/benchmark/agent-benchmark"
import {
  buildAgentBenchmarkReport,
  mergeAgentBenchmarkReports
} from "../../e2e/chromium/benchmark/agent-benchmark"

const attempt = (
  family: string,
  scenario: string,
  attemptIndex = 1
): AgentAttemptRecord => ({
  family,
  scenario,
  attempt: attemptIndex,
  backend: "cdp",
  terminalStatus: "completed",
  expectedStatus: "completed",
  steps: 3,
  observations: 3,
  modelCalls: 3,
  approvalsAsked: 0,
  approvalsGranted: 0,
  repeatedTargets: 0,
  ambiguousTargets: 0,
  wallMs: 4200,
  succeeded: true
})

const partial = (attempts: AgentAttemptRecord[]): AgentBenchmarkReport => ({
  measuredAt: "2026-09-17T00:00:00.000Z",
  backend: "cdp",
  model: "fixture-agent",
  reasoningEffort: "xhigh",
  attempts,
  families: []
})

/**
 * The completeness guard the suite used to carry in the worker that wrote the
 * report. It lives in the merge now, because a sharded pass has no worker that
 * sees every attempt — and a shard that never ran at all left nothing behind
 * to assert on.
 */
describe("agent benchmark merge", () => {
  it("joins every shard's attempts into one record", () => {
    const merged = mergeAgentBenchmarkReports(
      [
        partial([attempt("single-action", "click")]),
        partial([attempt("editors", "replace-then-save")])
      ],
      2
    )

    expect(merged.found).toBe(2)
    expect(merged.complete).toBe(true)
    expect(merged.report.attempts.map((row) => row.scenario)).toEqual([
      "click",
      "replace-then-save"
    ])
    expect(merged.report.reasoningEffort).toBe("xhigh")
  })

  it("records Nanobrowser's default reasoning effort", () => {
    const originalProduct = process.env.AGENT_BENCHMARK_PRODUCT
    const originalEffort = process.env.AGENT_HOSTED_REASONING_EFFORT
    try {
      process.env.AGENT_BENCHMARK_PRODUCT = "nanobrowser"
      delete process.env.AGENT_HOSTED_REASONING_EFFORT

      expect(buildAgentBenchmarkReport([], "cdp").reasoningEffort).toBe(
        "medium"
      )
    } finally {
      if (originalProduct === undefined)
        delete process.env.AGENT_BENCHMARK_PRODUCT
      else process.env.AGENT_BENCHMARK_PRODUCT = originalProduct
      if (originalEffort === undefined)
        delete process.env.AGENT_HOSTED_REASONING_EFFORT
      else process.env.AGENT_HOSTED_REASONING_EFFORT = originalEffort
    }
  })

  it("refuses partials whose reasoning efforts differ", () => {
    const mixed = mergeAgentBenchmarkReports(
      [
        partial([attempt("single-action", "click")]),
        {
          ...partial([attempt("editors", "replace-then-save")]),
          reasoningEffort: "high"
        }
      ],
      2
    )

    expect(mixed.found).toBe(2)
    expect(mixed.complete).toBe(false)
    expect(mixed.reasoningEfforts).toEqual(["high", "xhigh"])
    expect(mixed.report.reasoningEffort).toBeUndefined()
  })

  it("refuses a partial with missing effort evidence mixed with a labeled one", () => {
    const unlabeled = partial([attempt("single-action", "click")])
    delete unlabeled.reasoningEffort
    const mixed = mergeAgentBenchmarkReports(
      [unlabeled, partial([attempt("editors", "replace-then-save")])],
      2
    )

    expect(mixed.complete).toBe(false)
    expect(mixed.reasoningEfforts).toEqual(["<missing>", "xhigh"])
    expect(mixed.report.reasoningEffort).toBeUndefined()
  })

  it("refuses a pass that is short of what the suite declares", () => {
    const merged = mergeAgentBenchmarkReports(
      [partial([attempt("single-action", "click")])],
      2
    )

    expect(merged.complete).toBe(false)
    expect(merged.found).toBe(1)
    expect(merged.expected).toBe(2)
  })

  it("refuses a shard counted twice", () => {
    const rows = [attempt("single-action", "click")]
    const merged = mergeAgentBenchmarkReports([partial(rows), partial(rows)], 2)

    expect(merged.found).toBe(2)
    expect(merged.complete).toBe(false)
    expect(merged.duplicates).toEqual(["single-action/click"])
  })

  it("separates repeated attempts of one scenario from a duplicate", () => {
    const merged = mergeAgentBenchmarkReports(
      [
        partial([attempt("single-action", "click", 1)]),
        partial([attempt("single-action", "click", 2)])
      ],
      2
    )

    expect(merged.complete).toBe(true)
    expect(merged.duplicates).toEqual([])
  })

  it("reports nothing rather than throwing when no shard wrote anything", () => {
    const merged = mergeAgentBenchmarkReports([], 31)

    expect(merged.found).toBe(0)
    expect(merged.complete).toBe(false)
    expect(merged.report.backend).toBe("unknown")
  })
})
