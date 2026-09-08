import type { AgentDecision } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  AGENT_RUN_ACTIVE_BUDGET_MS,
  AGENT_STEP_ACTIVE_BUDGET_MS,
  beginAgentStepDeadline,
  classifyNoProgress,
  expiredAgentDeadline,
  initialAgentDeadlineState,
  resumeAgentDeadlines,
  suspendAgentDeadlines
} from "../budgets"

const complete: AgentDecision = { type: "complete", summary: "Done" }
const wait: AgentDecision = {
  type: "command",
  command: {
    type: "wait",
    condition: "Ready",
    timeoutMs: 1_000,
    snapshotId: "snapshot-1",
    generation: 1
  }
}

describe("agent budgets", () => {
  it("persists and restores suspension of both deadline levels", () => {
    const initial = initialAgentDeadlineState(100)
    const suspended = suspendAgentDeadlines(initial, "approval", 150)
    const restored = JSON.parse(JSON.stringify(suspended))
    const resumed = resumeAgentDeadlines(restored, 1_150)

    expect(resumed).toMatchObject({
      runSuspendedMs: 1_000,
      stepSuspendedMs: 1_000
    })
    expect(resumed).not.toHaveProperty("suspendedAt")
    expect(resumed).not.toHaveProperty("suspensionKind")
  })
  it("counts active runtime", () => {
    expect(
      expiredAgentDeadline(initialAgentDeadlineState(0), 1_500, {
        runMs: 1_000
      })
    ).toBe("run")
    expect(
      expiredAgentDeadline(initialAgentDeadlineState(0), 500, { runMs: 1_000 })
    ).toBeUndefined()
  })

  it("does not charge the run for an open approval wait", () => {
    const suspended = suspendAgentDeadlines(
      initialAgentDeadlineState(0),
      "approval",
      100
    )
    // Ten seconds of wall clock, a tenth of a second of the run's own time.
    expect(
      expiredAgentDeadline(suspended, 10_100, { runMs: 1_000 })
    ).toBeUndefined()
  })

  it("does not charge the step for a takeover that outlasted it", () => {
    const suspended = suspendAgentDeadlines(
      initialAgentDeadlineState(0),
      "takeover",
      50
    )
    expect(
      expiredAgentDeadline(suspended, 60_050, { stepMs: 1_000 })
    ).toBeUndefined()
  })

  it("charges the run again once the wait is resumed", () => {
    const resumed = resumeAgentDeadlines(
      suspendAgentDeadlines(initialAgentDeadlineState(0), "approval", 100),
      1_100
    )
    expect(
      expiredAgentDeadline(resumed, 1_300, { runMs: 1_000 })
    ).toBeUndefined()
    expect(expiredAgentDeadline(resumed, 2_200, { runMs: 1_000 })).toBe("run")
  })

  it("expires a step without expiring the run that carries it", () => {
    const state = beginAgentStepDeadline(initialAgentDeadlineState(0), 1_000)
    expect(
      expiredAgentDeadline(state, 1_400, { runMs: 10_000, stepMs: 300 })
    ).toBe("step")
  })

  it("states the ceilings the product promises", () => {
    expect(AGENT_RUN_ACTIVE_BUDGET_MS).toBe(600_000)
    expect(AGENT_STEP_ACTIVE_BUDGET_MS).toBe(60_000)
  })

  it("exempts wait from no-progress", () => {
    const point = {
      url: "https://example.com",
      snapshotHash: "same",
      decision: wait
    }
    expect(
      classifyNoProgress({ previous: point, current: point, previousCount: 2 })
    ).toEqual({ noProgress: false, count: 2 })
  })

  it("resets no-progress after confirmed verification", () => {
    const point = {
      url: "https://example.com",
      snapshotHash: "same",
      decision: complete
    }
    expect(
      classifyNoProgress({
        previous: point,
        current: point,
        previousCount: 2,
        verificationOutcome: "confirmed"
      })
    ).toEqual({ noProgress: false, count: 0 })
  })

  it("counts identical URL snapshot hash and decision as no-progress", () => {
    const point = {
      url: "https://example.com",
      snapshotHash: "same",
      decision: complete
    }
    expect(
      classifyNoProgress({ previous: point, current: point, previousCount: 1 })
    ).toEqual({ noProgress: true, count: 2 })
  })

  it("ignores fresh grounding tokens when the semantic command repeats", () => {
    const first = {
      url: "https://example.com",
      snapshotHash: "same",
      decision: wait
    }
    const second = {
      ...first,
      decision: {
        type: "command" as const,
        command: {
          ...wait.command,
          snapshotId: "snapshot-2",
          generation: 2
        }
      }
    }
    expect(
      classifyNoProgress({ previous: first, current: second, previousCount: 0 })
    ).toEqual({ noProgress: false, count: 0 })

    const firstRead: AgentDecision = {
      type: "command",
      command: { type: "read", snapshotId: "snapshot-1", generation: 1 }
    }
    const secondRead: AgentDecision = {
      type: "command",
      command: { type: "read", snapshotId: "snapshot-2", generation: 2 }
    }
    expect(
      classifyNoProgress({
        previous: { ...first, decision: firstRead },
        current: { ...second, decision: secondRead },
        previousCount: 0
      })
    ).toEqual({ noProgress: true, count: 1 })
  })
})
