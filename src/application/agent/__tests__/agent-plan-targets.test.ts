import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import {
  AGENT_PLAN_TOOL,
  AgentPlanTargetError,
  parseAgentTaskPlan
} from "../agent-plan"

const call = (args: unknown): ToolCall => ({
  id: "call-1",
  name: "agent_plan",
  arguments: args as ToolCall["arguments"]
})

const deleteB = {
  text: "Invoice B is deleted",
  kind: "change",
  source: "Delete Invoice B",
  check: { type: "record_state", record: "Invoice B", state: "deleted" }
}

const bookFlight = {
  text: "The flight is booked",
  kind: "change",
  source: "Book the flight"
}

describe("constraint targets in a plan", () => {
  it("advertises times and about to the planner", () => {
    const text = JSON.stringify(AGENT_PLAN_TOOL.parameters)
    expect(text).toContain('"times"')
    expect(text).toContain('"other_records"')
  })

  it("marks only the planner's own classes as inferred", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [bookFlight],
          constraints: [
            {
              text: "Do not add travel insurance.",
              kind: "exclude",
              source: "Don't add travel insurance",
              forbids: ["potential_commit"],
              about: {
                type: "option",
                hold: {
                  type: "checked",
                  name: "travel insurance",
                  checked: false
                }
              }
            }
          ]
        })
      ],
      { goal: "Book the flight. Don't add travel insurance." }
    )
    expect(plan.constraints?.[0]).toMatchObject({
      forbids: ["potential_commit"],
      inferred: ["potential_commit"],
      about: { type: "option" }
    })
  })

  it("never marks a class the user's words gave as inferred, whatever the planner sends", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [deleteB],
          constraints: [
            {
              text: "Do not delete any other invoice.",
              kind: "exclude",
              source: "Don't delete any other invoice",
              forbids: ["destructive"],
              inferred: ["destructive"],
              narrowedFor: ["r1"],
              about: { type: "other_records" }
            }
          ]
        })
      ],
      { goal: "Delete Invoice B. Don't delete any other invoice." }
    )
    const constraint = plan.constraints?.find((entry) =>
      entry.forbids?.includes("destructive")
    )
    expect(constraint?.forbids).toContain("destructive")
    expect(constraint?.inferred ?? []).not.toContain("destructive")
    expect(constraint?.narrowedFor).toBeUndefined()
  })

  it("adds the user's ban when only a planner-inferred class elsewhere covered it", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            {
              text: "The name is filled in; do not submit it",
              kind: "change",
              source: "Fill in the name"
            }
          ],
          constraints: [
            {
              text: "Don't add travel insurance",
              kind: "exclude",
              source: "Don't add travel insurance",
              forbids: ["submission"],
              about: {
                type: "option",
                hold: {
                  type: "checked",
                  name: "travel insurance",
                  checked: false
                }
              }
            }
          ]
        })
      ],
      {
        goal: "Fill in the name. Do not submit it. Don't add travel insurance."
      }
    )
    expect(
      plan.constraints?.some(
        (constraint) =>
          constraint.forbids?.includes("submission") &&
          !constraint.inferred?.includes("submission")
      )
    ).toBe(true)
  })

  it("never merges away the copy whose class came from the user's words", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            { text: "The name is Ada", kind: "change", source: "Set name Ada" }
          ],
          constraints: [
            {
              text: "Do not submit",
              kind: "exclude",
              source: "do not submit",
              about: { type: "effect" }
            },
            {
              text: "Do not submit",
              kind: "exclude",
              source: "do not submit",
              forbids: ["submission", "payment"],
              about: { type: "effect" }
            }
          ]
        })
      ],
      { goal: "Set name Ada, do not submit" }
    )
    expect(
      plan.constraints?.some(
        (constraint) =>
          constraint.forbids?.includes("submission") &&
          !constraint.inferred?.includes("submission")
      )
    ).toBe(true)
  })

  it("keeps nothing liftable without the user's words to tell classes apart", () => {
    const plan = parseAgentTaskPlan([
      call({
        requirements: [deleteB],
        constraints: [
          {
            text: "Do not delete any other invoice.",
            kind: "exclude",
            source: "Don't delete any other invoice",
            forbids: ["destructive"],
            about: { type: "other_records" }
          }
        ]
      })
    ])
    expect(plan.constraints?.[0]?.inferred).toBeUndefined()
  })

  it("drops an option target whose control the user's words never name", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [bookFlight],
          constraints: [
            {
              text: "Do not add travel insurance.",
              kind: "exclude",
              source: "Don't add travel insurance",
              forbids: ["potential_commit"],
              about: {
                type: "option",
                hold: { type: "checked", name: "Book flight", checked: true }
              }
            }
          ]
        })
      ],
      {
        goal: "Book the flight. Don't add travel insurance.",
        targetAsked: true
      }
    )
    expect(plan.constraints?.[0]?.about).toBeUndefined()
  })

  it("asks once for a target on a new exclusion in a plan that changes something", () => {
    const untargeted = {
      requirements: [deleteB],
      constraints: [
        {
          text: "Do not delete any other invoice.",
          kind: "exclude",
          source: "Don't delete any other invoice"
        }
      ]
    }
    const context = {
      goal: "Delete Invoice B. Don't delete any other invoice."
    }
    let refused: unknown
    try {
      parseAgentTaskPlan([call(untargeted)], context)
    } catch (error) {
      refused = error
    }
    expect(refused).toBeInstanceOf(AgentPlanTargetError)
    /** The fallback keeps the exclusion binding every class it forbids. */
    const fallback = (refused as AgentPlanTargetError).plan
    expect(fallback.constraints?.[0]).toMatchObject({
      forbids: ["destructive"]
    })
    expect(fallback.constraints?.[0]?.about).toBeUndefined()
    /** The second answer without a target is accepted as it is. */
    expect(
      parseAgentTaskPlan([call(untargeted)], { ...context, targetAsked: true })
        .constraints
    ).toHaveLength(1)
    /** A plan that only reads owes no target. */
    expect(() =>
      parseAgentTaskPlan(
        [
          call({
            requirements: [
              {
                text: "Report the invoice totals",
                kind: "read",
                source: "Report the invoice totals"
              }
            ],
            constraints: untargeted.constraints
          })
        ],
        { goal: "Report the invoice totals. Don't delete any invoice." }
      )
    ).not.toThrow()
  })

  it("keeps a count on a change and drops one on a read", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            {
              text: "The order is placed",
              kind: "change",
              source: "place the order once",
              times: 1
            },
            {
              text: "Report the total",
              kind: "read",
              source: "report the total",
              times: 2
            },
            {
              text: "The note is saved",
              kind: "change",
              source: "save the note",
              times: 0
            }
          ]
        })
      ],
      { goal: "Place the order once, save the note and report the total" }
    )
    expect(plan.requirements.map((entry) => entry.times)).toEqual([
      1,
      undefined,
      undefined
    ])
  })
})
