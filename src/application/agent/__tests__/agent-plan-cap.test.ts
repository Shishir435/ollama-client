import {
  agentAmendedPlanPatch,
  agentConfirmedRemovalPatch
} from "@ollama-client/agent-runtime"
import { describe, expect, it } from "vitest"
import { parseAgentTaskPlan } from "../agent-plan"

describe("amending an itemized plan at capacity", () => {
  it("confirms removal first, then plans the original added item without losing it", () => {
    const items = Array.from({ length: 12 }, (_, index) => `Row ${index + 1}`)
    const requirement = {
      id: "r1",
      text: "the rows are read",
      kind: "read" as const,
      items,
      source: "Read every row"
    }
    const state = {
      id: "run-1",
      requirements: [requirement],
      constraints: [],
      plan: {
        version: 1,
        issued: { requirements: 1, constraints: 0 },
        reconciledThrough: 1
      }
    }
    const answers = [
      {
        questionId: "q",
        text: "Also read Row 13 and remove Row 1",
        answeredAt: 5
      }
    ]
    const current = {
      requirements: state.requirements,
      constraints: state.constraints,
      ...state.plan
    }
    const plan = parseAgentTaskPlan(
      [
        {
          id: "call-plan",
          name: "agent_plan",
          arguments: {
            requirements: [
              { ...requirement, keep: "r1", items: [...items, "Row 13"] }
            ],
            dropped: [{ id: "r1", item: "Row 1" }]
          }
        }
      ],
      { goal: "Read every row", answers, current }
    )
    expect(plan).toMatchObject({
      requirements: state.requirements,
      proposedRemovals: [{ id: "r1", item: "Row 1" }],
      provisional: true
    })
    const patch = agentAmendedPlanPatch(state, plan, 5, 6)
    const removed = agentConfirmedRemovalPatch(
      { ...state, ...patch },
      "yes",
      7,
      7
    )
    expect(removed.plan?.reconciledThrough).toBe(1)
    const requirements = removed.requirements ?? []
    const resumed = parseAgentTaskPlan(
      [
        {
          id: "call-plan",
          name: "agent_plan",
          arguments: {
            requirements: [
              {
                ...requirement,
                keep: "r1",
                items: [...items.slice(1), "Row 13"]
              }
            ]
          }
        }
      ],
      {
        goal: "Read every row",
        answers,
        current: { ...current, ...removed.plan, requirements }
      }
    )
    expect(resumed.requirements[0]?.items).toEqual([
      ...items.slice(1),
      "Row 13"
    ])
    expect(resumed.provisional).toBeUndefined()
  })
})
