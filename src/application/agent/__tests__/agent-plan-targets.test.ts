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

  it("keeps a count above one only when the user wrote that number", () => {
    const timesFor = (source: string, times: number) =>
      parseAgentTaskPlan(
        [
          call({
            requirements: [{ text: source, kind: "change", source, times }]
          })
        ],
        { goal: source }
      ).requirements[0]?.times
    expect(timesFor("Send the note once", 2)).toBeUndefined()
    expect(timesFor("Submit it 2 times", 2)).toBe(2)
    /** A digit inside another number states neither. */
    expect(timesFor("Submit it 12 times", 2)).toBeUndefined()
    expect(timesFor("Submit it 2 times", 12)).toBeUndefined()
    expect(timesFor("Submit it 1.2 times", 2)).toBeUndefined()
    expect(timesFor("Submit it 12 times", 12)).toBe(12)
  })
})

describe("repeated plan entries", () => {
  const parse = (
    requirements: Record<string, unknown>[],
    constraints: Record<string, unknown>[] = []
  ) =>
    parseAgentTaskPlan([call({ requirements, constraints })], {
      goal: "Submit it 2 times. Don't add travel insurance or seat selection.",
      targetAsked: true
    })
  const submit = {
    text: "The form is submitted",
    kind: "change",
    source: "Submit it 2 times"
  }

  it("never lets an uncounted copy stand for a counted one, in either order", () => {
    const counted = { ...submit, times: 2 }
    expect(parse([counted, submit]).requirements).toMatchObject([{ times: 2 }])
    expect(parse([submit, counted]).requirements).toMatchObject([{ times: 2 }])
  })

  it("keeps two holds of the same limit text as two constraints", () => {
    const hold = (name: string) => ({
      text: "Do not add extras.",
      kind: "exclude",
      source: "Don't add travel insurance or seat selection",
      about: {
        type: "option",
        hold: { type: "checked", name, checked: false }
      }
    })
    for (const order of [
      [hold("travel insurance"), hold("seat selection")],
      [hold("seat selection"), hold("travel insurance")]
    ]) {
      const constraints = parse([submit], order).constraints ?? []
      expect(
        constraints
          .map((entry) =>
            entry.about?.type === "option" ? entry.about.hold.name : undefined
          )
          .sort()
      ).toEqual(["seat selection", "travel insurance"])
    }
  })

  it("still drops a plain restatement", () => {
    expect(parse([submit, { ...submit }]).requirements).toHaveLength(1)
  })
})
