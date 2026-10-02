import { describe, expect, it, vi } from "vitest"

vi.mock("../../e2e/chromium/fixtures/extension", () => ({ test: {} }))
vi.mock("../../e2e/chromium/fixtures/agent-scenario", () => ({
  runAgentScenario: vi.fn(),
  agentFixtureElement: vi.fn()
}))
vi.mock("../../e2e/chromium/fixtures/nanobrowser-scenario", () => ({
  runNanobrowserScenario: vi.fn()
}))

import {
  type AgentAttemptRecord,
  buildAgentBenchmarkReport,
  mergeAgentBenchmarkReports
} from "../../e2e/chromium/benchmark/agent-benchmark"
import { recordBenchmarkAttempt } from "../../e2e/chromium/benchmark/benchmark-tasks"
import type { AgentScenarioOutcome } from "../../e2e/chromium/fixtures/agent-scenario"

describe("current-head benchmark recording", () => {
  it("preserves a throwing scorer as an infrastructure result", async () => {
    const attempts: AgentAttemptRecord[] = []
    const outcome = {
      snapshot: { run: { status: "completed" }, steps: [] },
      attempt: 1,
      backend: "cdp",
      wire: [],
      messages: [],
      startedAt: Date.now()
    } as unknown as AgentScenarioOutcome
    await recordBenchmarkAttempt({
      attempts,
      family: "read",
      scenario: "read/broken",
      outcome,
      expectedStatus: "completed",
      succeeded: async () => {
        throw new Error("private page data")
      }
    })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].verdict).toBe("infrastructure_failure")
    expect(attempts[0].falseCompletion).toBe(false)
    expect(JSON.stringify(attempts)).not.toContain("private page data")
  })

  it("rejects mixed candidate/corpus inputs while preserving historical decoding", () => {
    const report = buildAgentBenchmarkReport([], "cdp", "fixture-agent")
    if (!report.inputs) throw new Error("Missing pinned inputs")
    const other = {
      ...report,
      inputs: { ...report.inputs, candidateSha: "different" }
    }
    expect(mergeAgentBenchmarkReports([report, other], 0).complete).toBe(false)
    const legacy = {
      measuredAt: "2026-01-01",
      backend: "cdp",
      model: "old",
      attempts: [],
      families: []
    }
    expect(mergeAgentBenchmarkReports([legacy], 0).complete).toBe(true)
  })
})
