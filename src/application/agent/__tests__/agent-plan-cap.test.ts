import {
  agentAmendedPlanPatch,
  agentConfirmedRemovalPatch,
  agentInitialPlanPatch
} from "@ollama-client/agent-runtime"
import { describe, expect, it } from "vitest"
import { AgentPlanOverCapError, parseAgentTaskPlan } from "../agent-plan"

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

describe("capacity removal eligibility", () => {
  const requirement = {
    id: "r1",
    text: "Read rows",
    kind: "read" as const,
    source: "Read rows"
  }
  const constraints = Array.from({ length: 8 }, (_, index) => ({
    id: `c${index + 1}`,
    text: `Under $${index + 1}`,
    kind: "limit" as const
  }))
  const call = (dropped: { id: string; item?: string }[], items?: string[]) => [
    {
      id: "plan",
      name: "agent_plan",
      arguments: {
        requirements: [
          { ...requirement, keep: "r1", ...(items ? { items } : {}) }
        ],
        dropped
      }
    }
  ]
  it("refuses a requirement removal when constraints are full", () => {
    expect(() =>
      parseAgentTaskPlan(call([{ id: "r1" }]), {
        goal: "Read rows",
        answers: [
          { questionId: "q", text: "Only the first row", answeredAt: 2 }
        ],
        current: {
          requirements: [
            requirement,
            { ...requirement, id: "r2", text: "Read totals" }
          ],
          constraints,
          issued: { requirements: 2, constraints: 8 },
          reconciledThrough: 1
        }
      })
    ).toThrow(AgentPlanOverCapError)
  })
  it("refuses an unrelated removal for an oversized new requirement", () => {
    const items = Array.from({ length: 13 }, (_, index) => `Row ${index + 1}`)
    expect(() =>
      parseAgentTaskPlan(
        [
          {
            id: "plan",
            name: "agent_plan",
            arguments: {
              requirements: [
                { text: "Read rows", kind: "read", source: "Read rows", items }
              ],
              dropped: [{ id: "r1" }]
            }
          }
        ],
        {
          goal: `Read rows: ${items.join(", ")}`,
          current: {
            requirements: [
              { ...requirement, text: "Read totals" },
              { ...requirement, id: "r2", text: "Read summary" }
            ],
            constraints: [],
            issued: { requirements: 2, constraints: 0 },
            reconciledThrough: 0
          }
        }
      )
    ).toThrow(AgentPlanOverCapError)
  })
  it("refuses removals that leave a second cap exceeded", () => {
    const requirements = Array.from({ length: 8 }, (_, index) => ({
      ...requirement,
      id: `r${index + 1}`,
      text: `Read report ${index + 1}`
    }))
    expect(() =>
      parseAgentTaskPlan(
        [
          {
            id: "plan",
            name: "agent_plan",
            arguments: {
              requirements: [
                { text: "Send message", kind: "change", source: "Send message" }
              ],
              dropped: [{ id: "c1" }]
            }
          }
        ],
        {
          goal: "Send message",
          answers: [
            { questionId: "q", text: "Only the first row", answeredAt: 2 }
          ],
          current: {
            requirements,
            constraints,
            issued: { requirements: 8, constraints: 8 },
            reconciledThrough: 1
          }
        }
      )
    ).toThrow(AgentPlanOverCapError)
  })
  it("confirms an inherited withdrawal and then fits the follow-up's new boundary", () => {
    const goal = "Read rows. Only the first row"
    const answers = [
      {
        questionId: "capacity",
        text: "Withdraw the first inherited limit",
        answeredAt: 2
      }
    ]
    const plan = parseAgentTaskPlan(call([{ id: "c1" }]), {
      goal,
      answers,
      previousConstraints: constraints
    })
    expect(plan).toMatchObject({
      constraints,
      provisional: true,
      proposedRemovals: [{ id: "c1" }]
    })
    const initial = agentInitialPlanPatch({ id: "follow-up", answers }, plan, 3)
    expect(initial.requirements).toHaveLength(1)
    expect(initial.plan?.pending).toMatchObject({
      provisional: true,
      removals: [{ id: "c1" }]
    })
    expect(initial.plan?.reconciledThrough).toBeUndefined()
    const removed = agentConfirmedRemovalPatch(initial, "yes", 4, 4)
    const resumed = parseAgentTaskPlan(call([]), {
      goal,
      answers: [
        ...answers,
        { questionId: "removal", text: "yes", answeredAt: 4 }
      ],
      current: {
        requirements: initial.requirements ?? [],
        constraints: removed.constraints ?? [],
        issued: removed.plan?.issued ?? { requirements: 1, constraints: 8 }
      }
    })
    expect(resumed.constraints).toHaveLength(8)
    expect(
      resumed.constraints?.some((entry) => entry.text === "Under $1")
    ).toBe(false)
    expect(
      resumed.constraints?.some((entry) => entry.text === "Only the first row")
    ).toBe(true)
    expect(resumed.provisional).toBeUndefined()
  })
})
