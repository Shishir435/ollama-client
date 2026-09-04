import type { AgentDecision } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  classifyNoProgress,
  createAgentBudgetTracker,
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
    let now = 0
    const tracker = createAgentBudgetTracker({ now: () => now })
    now = 1_500
    expect(tracker.snapshot().activeRuntimeMs).toBe(1_500)
  })

  it("suspends the run deadline during approval", () => {
    let now = 0
    const tracker = createAgentBudgetTracker({ now: () => now })
    now = 100
    tracker.suspend("approval")
    now = 1_100
    expect(tracker.snapshot().activeRuntimeMs).toBe(100)
  })

  it("suspends the per-step deadline during approval", () => {
    let now = 0
    const tracker = createAgentBudgetTracker({ now: () => now })
    tracker.beginStep()
    now = 100
    tracker.suspend("approval")
    now = 1_100
    expect(tracker.snapshot().activeStepMs).toBe(100)
  })

  it("suspends both deadlines during takeover", () => {
    let now = 0
    const tracker = createAgentBudgetTracker({ now: () => now })
    now = 50
    tracker.suspend("takeover")
    now = 1_050
    expect(tracker.snapshot()).toMatchObject({
      activeRuntimeMs: 50,
      activeStepMs: 50
    })
  })

  it("resumes both deadlines after the wait state", () => {
    let now = 0
    const tracker = createAgentBudgetTracker({ now: () => now })
    now = 100
    tracker.suspend("approval")
    now = 1_100
    tracker.resume()
    now = 1_300
    expect(tracker.snapshot()).toMatchObject({
      activeRuntimeMs: 300,
      activeStepMs: 300
    })
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

  it("fails visibly after the malformed-response budget", () => {
    const tracker = createAgentBudgetTracker({
      now: () => 0,
      maxMalformedDecisions: 2
    })
    expect(tracker.recordMalformedDecision()).toBe(false)
    expect(tracker.recordMalformedDecision()).toBe(true)
    expect(tracker.snapshot().malformedBudgetExhausted).toBe(true)
  })
})
