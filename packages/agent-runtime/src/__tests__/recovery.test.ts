import {
  AGENT_RECOVERY_STRATEGIES,
  AgentRunStateSchema,
  MAX_AGENT_RECOVERY_ATTEMPTS
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import {
  AGENT_RECOVERY_GUIDANCE,
  planAgentRecovery,
  settledAgentRecovery
} from "../recovery"

const start = {
  trigger: "no_progress" as const,
  now: 5,
  visionAvailable: true
}

describe("planning a recovery", () => {
  it("opens an episode with the cheapest strategy for the trigger", () => {
    expect(planAgentRecovery(undefined, { ...start, evidenceStep: 3 })).toEqual(
      {
        type: "recover",
        strategy: "targeted_read",
        recovery: {
          attempts: 1,
          active: {
            trigger: "no_progress",
            strategy: "targeted_read",
            tried: ["targeted_read"],
            startedAt: 5,
            evidenceStep: 3
          }
        }
      }
    )
  })

  it("never offers a strategy the episode already tried, whatever triggered it", () => {
    const first = planAgentRecovery(undefined, {
      ...start,
      trigger: "refused_commands"
    })
    if (first.type !== "recover") throw new Error("expected a strategy")
    const second = planAgentRecovery(first.recovery, { ...start, now: 9 })
    expect(second).toMatchObject({
      type: "recover",
      strategy: "targeted_read",
      recovery: {
        attempts: 2,
        active: {
          trigger: "no_progress",
          tried: ["fresh_observation", "targeted_read"],
          startedAt: 5
        }
      }
    })
  })

  it("skips a look the run cannot take", () => {
    let recovery = planAgentRecovery(undefined, {
      ...start,
      visionAvailable: false
    })
    const tried: string[] = []
    while (recovery.type === "recover") {
      tried.push(recovery.strategy)
      recovery = planAgentRecovery(recovery.recovery, {
        ...start,
        visionAvailable: false
      })
    }
    expect(tried).not.toContain("request_vision")
    expect(recovery).toMatchObject({
      type: "exhausted",
      attempts: tried.length
    })
  })

  it("keeps an unresolved effect to evidence only", () => {
    const plan = planAgentRecovery(undefined, {
      ...start,
      trigger: "unresolved_effect"
    })
    expect(plan).toMatchObject({ strategy: "fresh_observation" })
    if (plan.type !== "recover") throw new Error("expected a strategy")
    expect(
      planAgentRecovery(plan.recovery, {
        ...start,
        trigger: "unresolved_effect"
      }).type
    ).toBe("exhausted")
  })

  it("offers a run that keeps claiming it is done one read, not every strategy", () => {
    const plan = planAgentRecovery(undefined, {
      ...start,
      trigger: "refused_completion"
    })
    expect(plan).toMatchObject({ strategy: "targeted_read" })
    if (plan.type !== "recover") throw new Error("expected a strategy")
    expect(
      planAgentRecovery(plan.recovery, {
        ...start,
        trigger: "refused_completion"
      })
    ).toMatchObject({ type: "exhausted", attempts: 1 })
  })

  it("stops at the run-wide ceiling even with untried strategies left", () => {
    expect(
      planAgentRecovery(
        { attempts: MAX_AGENT_RECOVERY_ATTEMPTS },
        { ...start, trigger: "stale_snapshot" }
      )
    ).toEqual({
      type: "exhausted",
      attempts: MAX_AGENT_RECOVERY_ATTEMPTS,
      tried: []
    })
  })

  it("closes an episode without refunding what it spent", () => {
    expect(
      settledAgentRecovery({
        attempts: 3,
        active: {
          trigger: "no_progress",
          strategy: "alternate_route",
          tried: ["targeted_read", "wait_for_condition", "alternate_route"],
          startedAt: 1
        }
      })
    ).toEqual({ attempts: 3 })
    expect(settledAgentRecovery(undefined)).toBeUndefined()
  })

  it("has guidance for every strategy, and none of it loosens the task", () => {
    for (const strategy of AGENT_RECOVERY_STRATEGIES)
      expect(AGENT_RECOVERY_GUIDANCE[strategy].length).toBeGreaterThan(0)
    expect(AGENT_RECOVERY_GUIDANCE.revise_approach).toContain(
      "requirements and its constraints are unchanged"
    )
  })
})

describe("the durable recovery record", () => {
  const run = {
    version: 1,
    id: "run-1",
    goal: "Do it",
    status: "observing",
    stepCount: 0,
    observationCount: 0,
    controlledTabId: 1,
    providerId: "ollama",
    modelId: "model",
    allowedOrigins: [],
    createdAt: 1,
    updatedAt: 1
  }

  it("decodes a row written before recovery existed", () => {
    expect(AgentRunStateSchema.safeParse(run).success).toBe(true)
  })

  it("refuses a spent count above the ceiling and an unknown strategy", () => {
    expect(
      AgentRunStateSchema.safeParse({
        ...run,
        recovery: { attempts: MAX_AGENT_RECOVERY_ATTEMPTS + 1 }
      }).success
    ).toBe(false)
    expect(
      AgentRunStateSchema.safeParse({
        ...run,
        recovery: {
          attempts: 1,
          active: {
            trigger: "no_progress",
            strategy: "click_harder",
            tried: ["click_harder"],
            startedAt: 1
          }
        }
      }).success
    ).toBe(false)
  })
})
