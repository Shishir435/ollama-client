import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import { AgentDecisionFormatError } from "../agent-decision-parser"
import { parseAgentTaskPlan } from "../agent-plan"

const goal =
  "Compare the three hotels linked on this page and book the cheapest one rated 4 stars or higher for Ada Lovelace, one night. Don't book anything over 120 credits a night."
const readText =
  "Compare the three hotels linked on this page, including their rates and star ratings."
const proposal = () => ({
  requirements: [
    {
      kind: "read",
      text: readText,
      source: goal,
      beforeChanges: true,
      items: ["hotel link 1", "hotel link 2", "hotel link 3"]
    },
    {
      kind: "change",
      text: "Book the cheapest eligible hotel for Ada Lovelace for one night.",
      source: goal,
      persist: true
    }
  ],
  constraints: [
    {
      kind: "limit",
      text: "Don't book anything over 120 credits a night.",
      source: "Don't book anything over 120 credits a night."
    }
  ]
})
const call = (args: unknown): ToolCall => ({
  id: "plan",
  name: "agent_plan",
  arguments: args as ToolCall["arguments"]
})
const rejected = (args: unknown) => {
  try {
    parseAgentTaskPlan([call(args)], { goal, utterance: goal })
  } catch (error) {
    if (error instanceof AgentDecisionFormatError) return error
    throw error
  }
  throw new Error("invalid plan was accepted")
}

describe("independent plan validation feedback", () => {
  it("reports invented items and unsupported ordering together on the first rejection", () => {
    const error = rejected(proposal())
    expect(error.message).toContain("item is not the user's words")
    expect(error.feedback).toContain("omit items")
    expect(error.feedback).toContain(
      "beforeChanges adds a run-wide ordering constraint"
    )
    expect(error.feedback?.match(/beforeChanges adds/g)).toHaveLength(1)
  })
  it("does not return a partial plan when another requirement is valid", () => {
    const args = proposal()
    expect(() =>
      parseAgentTaskPlan([call(args)], { goal, utterance: goal })
    ).toThrow(AgentDecisionFormatError)
    expect(args.requirements).toHaveLength(2)
    expect(args.requirements[0].items).toHaveLength(3)
  })
  it("accepts the corrected plan without dropping comparison, booking, names or price limits", () => {
    const args = proposal()
    const {
      items: _items,
      beforeChanges: _before,
      ...read
    } = args.requirements[0]
    const plan = parseAgentTaskPlan(
      [call({ ...args, requirements: [read, args.requirements[1]] })],
      { goal, utterance: goal }
    )
    expect(plan.requirements).toHaveLength(2)
    expect(plan.requirements[0]).toMatchObject({
      text: readText,
      kind: "read",
      source: goal
    })
    expect(plan.requirements[0].items).toBeUndefined()
    expect(plan.requirements[0].beforeChanges).toBeUndefined()
    expect(plan.requirements[1]).toMatchObject({
      text: args.requirements[1].text,
      persist: true
    })
    expect(plan.constraints).toContainEqual(
      expect.objectContaining(args.constraints[0])
    )
  })
  it("preserves user-named items and explicit ordering", () => {
    const goal = "Compare Garden Hotel and River Hotel, then book a room."
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            {
              kind: "read",
              text: "Compare Garden Hotel and River Hotel",
              items: ["Garden Hotel", "River Hotel"],
              beforeChanges: true,
              source: goal
            }
          ]
        })
      ],
      { goal, utterance: goal }
    )
    expect(plan.requirements[0]).toMatchObject({
      items: ["Garden Hotel", "River Hotel"],
      beforeChanges: true
    })
  })
  it("does not turn page names introduced by the chat goal into user-named items", () => {
    const args = proposal()
    const inventedGoal = `${goal} The hotel links are hotel link 1, hotel link 2, hotel link 3.`
    expect(() =>
      parseAgentTaskPlan([call(args)], { goal: inventedGoal, utterance: goal })
    ).toThrow("item is not the user's words")
  })
  it("accepts items explicitly added in a user answer", () => {
    const goal = "Compare the hotels."
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            {
              kind: "read",
              text: "Compare Garden Hotel and River Hotel",
              items: ["Garden Hotel", "River Hotel"],
              source: "Compare Garden Hotel and River Hotel"
            }
          ]
        })
      ],
      {
        goal,
        utterance: goal,
        answers: [
          {
            questionId: "q",
            text: "Compare Garden Hotel and River Hotel",
            answeredAt: 1
          }
        ]
      }
    )
    expect(plan.requirements[0].items).toEqual(["Garden Hotel", "River Hotel"])
  })
})
