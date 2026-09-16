import { describe, expect, it } from "vitest"
import type { AgentAttemptRecord } from "../../e2e/chromium/benchmark/agent-benchmark"
import {
  attemptTelemetry,
  summarizeAttempts
} from "../../e2e/chromium/benchmark/agent-benchmark"

const record = (
  overrides: Partial<AgentAttemptRecord> = {}
): AgentAttemptRecord => ({
  family: "single-action",
  scenario: "click",
  backend: "dom",
  attempt: 1,
  modelCalls: 2,
  expectedStatus: "completed",
  terminalStatus: "completed",
  steps: 2,
  observations: 2,
  approvalsAsked: 0,
  approvalsGranted: 0,
  repeatedTargets: 0,
  ambiguousTargets: 0,
  wallMs: 3_000,
  ...overrides
})

describe("benchmark telemetry", () => {
  /**
   * Read from the steps' receipts rather than the model wire: a receipt is
   * every provider's, and it survives the worker restart that makes a run
   * worth measuring.
   */
  it("sums what the steps recorded", () => {
    expect(
      attemptTelemetry([
        {
          telemetry: { promptTokens: 7_000, outputTokens: 90, decideMs: 2_100 }
        },
        {
          telemetry: { promptTokens: 7_400, outputTokens: 110, decideMs: 1_900 }
        }
      ])
    ).toEqual({
      promptTokens: 14_400,
      completionTokens: 200,
      decideMs: 4_000
    })
  })

  /** Unmeasured and zero are different claims, so absent stays absent. */
  it("reports nothing for a phase no step measured", () => {
    expect(attemptTelemetry([{ telemetry: { decideMs: 10 } }])).toEqual({
      decideMs: 10
    })
    expect(attemptTelemetry([{}, {}])).toEqual({})
  })

  it("fills the medians the report used to print as em-dashes", () => {
    const [summary] = summarizeAttempts([
      record({
        promptTokens: 7_000,
        decideMs: 2_000,
        observeMs: 100,
        retries: 1
      }),
      record({
        promptTokens: 9_000,
        decideMs: 4_000,
        observeMs: 300,
        retries: 0
      })
    ])

    expect(summary.medianPromptTokens).toBe(8_000)
    expect(summary.medianDecideMs).toBe(3_000)
    expect(summary.medianObserveMs).toBe(200)
    /** Retries are a total, not a median: they count wasted calls. */
    expect(summary.retries).toBe(1)
  })

  it("leaves a phase median absent when a scripted fixture measured none", () => {
    const [summary] = summarizeAttempts([record(), record()])

    expect(summary.medianDecideMs).toBeUndefined()
    expect(summary.medianPromptTokens).toBeUndefined()
    expect(summary.retries).toBe(0)
  })
})
