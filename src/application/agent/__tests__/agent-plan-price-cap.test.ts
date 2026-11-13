import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import { agentGoalBoundaries, parseAgentTaskPlan } from "../agent-plan"

const cap = "Don't book anything over 120 credits a night."
const goal = `Compare the linked hotels and book a room for Ada, one night. ${cap}`
const call: ToolCall = {
  id: "plan",
  name: "agent_plan",
  arguments: {
    requirements: [
      { text: "Book a room for Ada, one night", kind: "change", source: goal }
    ],
    constraints: [
      { kind: "limit", text: cap, source: goal, forbids: ["payment"] }
    ]
  }
}
it("keeps a conditional price cap without a model-invented blanket payment ban", () => {
  const plan = parseAgentTaskPlan([call], { goal, utterance: goal })
  expect(plan.constraints).toHaveLength(1)
  expect(plan.constraints?.[0]).toMatchObject({ text: cap, kind: "limit" })
  expect(plan.constraints?.[0].forbids).toBeUndefined()
})
it("keeps an explicit no-pay prohibition alongside the conditional booking cap", () => {
  const text = `${goal} Do not pay.`
  const plan = parseAgentTaskPlan([call], { goal: text, utterance: text })
  expect(plan.constraints?.some((c) => c.forbids?.includes("payment"))).toBe(
    true
  )
})
describe("native conditional clauses", () => {
  it.each([cap, "Don't book anything over 120.50 credits a night."])(
    "preserves the complete cap %s",
    (text) => {
      expect(agentGoalBoundaries(text)).toEqual([
        expect.objectContaining({
          kind: "limit",
          clause: text.slice(0, -1),
          forbids: []
        })
      ])
    }
  )
  it.each([
    "Don't book anything.",
    "Don't book anything over 120 credits a night until I approve.",
    "Don't book anything over 120 credits a night, and do not pay."
  ])("never lifts an unparsed prohibition: %s", (text) => {
    expect(agentGoalBoundaries(text).some((c) => c.forbids.length > 0)).toBe(
      true
    )
  })
})

it("enforces an omitted price cap even when the requirement source quotes it", () => {
  const plan = parseAgentTaskPlan(
    [
      {
        ...call,
        arguments: {
          requirements: [
            {
              text: "Book Garden Hotel for Ada for one night",
              kind: "change",
              source: goal
            }
          ]
        }
      }
    ],
    { goal, utterance: goal }
  )
  expect(plan.constraints).toEqual([
    expect.objectContaining({ kind: "limit", text: cap.slice(0, -1) })
  ])
  expect(plan.constraints?.[0].forbids).toBeUndefined()
})

describe("a numeric cap is the user's own clause", () => {
  const booking = {
    text: "Book a room for Ada, one night",
    kind: "change",
    source: goal
  }
  const plan = (
    constraint: Record<string, unknown>,
    context: Parameters<typeof parseAgentTaskPlan>[1]
  ) =>
    parseAgentTaskPlan(
      [
        {
          ...call,
          arguments: { requirements: [booking], constraints: [constraint] }
        }
      ],
      context
    )

  it("restores the user's amount when the model's text and source both widen it", () => {
    const widened = cap.replace("120", "150")
    const result = plan(
      { kind: "limit", text: widened, source: widened },
      { goal, utterance: goal }
    )
    expect(result.constraints?.map((entry) => entry.text)).toContain(
      cap.slice(0, -1)
    )
    expect(
      result.constraints?.some((entry) => entry.text.includes("150"))
    ).toBe(false)
  })

  it("matches a later lowered cap by its own clause, not the shared opening words", () => {
    const lowered = cap.replace("120", "100")
    const result = plan(
      { kind: "limit", text: lowered, source: lowered },
      {
        goal,
        utterance: goal,
        answers: [{ questionId: "q1", text: lowered, answeredAt: 2 }]
      }
    )
    expect(result.constraints?.map((entry) => entry.text)).toEqual(
      expect.arrayContaining([lowered])
    )
  })
})
