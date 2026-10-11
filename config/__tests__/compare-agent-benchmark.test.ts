import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import type {
  AgentAttemptRecord,
  AgentBenchmarkReport
} from "../../e2e/chromium/benchmark/agent-benchmark"

const attempt = (scenario: string): AgentAttemptRecord => ({
  family: "single-action",
  scenario,
  attempt: 1,
  backend: "cdp",
  terminalStatus: "completed",
  expectedStatus: "completed",
  steps: 1,
  observations: 1,
  modelCalls: 1,
  approvalsAsked: 0,
  approvalsGranted: 0,
  repeatedTargets: 0,
  ambiguousTargets: 0,
  wallMs: 100,
  succeeded: true
})

const report = (scenario: string): AgentBenchmarkReport => ({
  measuredAt: "2026-09-29T00:00:00.000Z",
  backend: "cdp",
  model: "codex/gpt-6-luna",
  reasoningEffort: "medium",
  attempts: [attempt(scenario)],
  families: []
})

describe("agent benchmark report comparison", () => {
  it("rejects reports with no matched attempts before writing comparison files", () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-benchmark-compare-"))
    const baselinePath = join(directory, "ollama-client.json")
    const candidatePath = join(directory, "nanobrowser.json")
    const outputDirectory = join(directory, "comparison")
    try {
      writeFileSync(baselinePath, JSON.stringify(report("click")))
      writeFileSync(candidatePath, JSON.stringify(report("fill")))

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("tools/benchmarks/compare-agent-benchmark-reports.ts"),
          baselinePath,
          candidatePath,
          outputDirectory
        ],
        { encoding: "utf8" }
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("no matched attempts")
      expect(existsSync(outputDirectory)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
