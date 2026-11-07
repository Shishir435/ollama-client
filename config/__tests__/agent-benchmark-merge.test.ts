import { describe, expect, it } from "vitest"
import type {
  AgentAttemptRecord,
  AgentBenchmarkReport
} from "../../e2e/chromium/benchmark/agent-benchmark"
import { mergeAgentBenchmarkReports } from "../../e2e/chromium/benchmark/agent-benchmark"

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

  /**
   * Playwright retries a failed test in a new worker, and each worker writes
   * its own partial. The try that failed (here a harness exception recorded by
   * the afterEach hook) and the try that finished are the same attempt in two
   * files — the shape that failed the merge on a CI run with every shard green.
   */
  describe("a Playwright retry", () => {
    const abandoned = (): AgentAttemptRecord => ({
      ...attempt("canvas-and-visual", "click-a-point"),
      retry: 0,
      terminalStatus: "harness_exception",
      verdict: "infrastructure_failure",
      steps: 0,
      succeeded: false
    })
    const finished = (retry: number): AgentAttemptRecord => ({
      ...attempt("canvas-and-visual", "click-a-point"),
      retry
    })

    it("replaces the try that failed instead of counting a second attempt", () => {
      const merged = mergeAgentBenchmarkReports(
        [
          partial([attempt("single-action", "click")]),
          partial([abandoned()]),
          partial([finished(1)])
        ],
        2
      )

      expect(merged.complete).toBe(true)
      expect(merged.found).toBe(2)
      expect(merged.duplicates).toEqual([])
      expect(merged.superseded).toEqual(["canvas-and-visual/click-a-point"])
      const kept = merged.report.attempts.find(
        (row) => row.scenario === "click-a-point"
      )
      expect(kept?.retry).toBe(1)
      expect(kept?.terminalStatus).toBe("completed")
    })

    it("keeps the later retry whichever partial is read first", () => {
      const merged = mergeAgentBenchmarkReports(
        [partial([finished(1)]), partial([abandoned()])],
        1
      )

      expect(merged.complete).toBe(true)
      expect(merged.report.attempts).toHaveLength(1)
      expect(merged.report.attempts[0]?.retry).toBe(1)
    })

    it("keeps the highest retry of a longer chain", () => {
      const merged = mergeAgentBenchmarkReports(
        [
          partial([finished(0)]),
          partial([finished(2)]),
          partial([finished(1)])
        ],
        1
      )

      expect(merged.complete).toBe(true)
      expect(merged.report.attempts[0]?.retry).toBe(2)
    })

    it("still records a retry that failed again as the attempt", () => {
      const merged = mergeAgentBenchmarkReports(
        [partial([finished(0)]), partial([{ ...abandoned(), retry: 1 }])],
        1
      )

      expect(merged.complete).toBe(true)
      expect(merged.report.attempts[0]?.terminalStatus).toBe(
        "harness_exception"
      )
    })

    it("does not excuse a shard counted twice that carries retry numbers", () => {
      const rows = [finished(0)]
      const merged = mergeAgentBenchmarkReports(
        [partial(rows), partial(rows)],
        1
      )

      expect(merged.complete).toBe(false)
      expect(merged.duplicates).toEqual(["canvas-and-visual/click-a-point"])
      expect(merged.superseded).toEqual([])
    })

    it("does not excuse a copy that carries no retry number", () => {
      const merged = mergeAgentBenchmarkReports(
        [
          partial([finished(1)]),
          partial([attempt("canvas-and-visual", "click-a-point")])
        ],
        1
      )

      expect(merged.complete).toBe(false)
      expect(merged.duplicates).toEqual(["canvas-and-visual/click-a-point"])
    })

    it("still refuses a pass that is short once the retry is resolved", () => {
      const merged = mergeAgentBenchmarkReports(
        [partial([abandoned()]), partial([finished(1)])],
        2
      )

      expect(merged.complete).toBe(false)
      expect(merged.found).toBe(1)
    })
  })

  it("reports nothing rather than throwing when no shard wrote anything", () => {
    const merged = mergeAgentBenchmarkReports([], 31)

    expect(merged.found).toBe(0)
    expect(merged.complete).toBe(false)
    expect(merged.report.backend).toBe("unknown")
  })
})
