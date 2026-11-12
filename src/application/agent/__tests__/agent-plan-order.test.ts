import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import { AgentDecisionFormatError } from "../agent-decision-parser"
import { parseAgentTaskPlan } from "../agent-plan"

const call = (requirements: unknown[]): ToolCall => ({
  id: "plan",
  name: "agent_plan",
  arguments: { requirements }
})
const read = {
  text: "Read the account code",
  kind: "read",
  source: "Read the account code"
}

describe("read-before-write planning", () => {
  it.each([
    "Read the account code, then fill the destination.",
    "Read the account code before you fill the destination.",
    "First read the account code then fill the destination."
  ])(
    "retains explicit ordering when the planner omits its flag: %s",
    (goal) => {
      const plan = parseAgentTaskPlan(
        [
          call([
            read,
            {
              text: "Fill the destination",
              kind: "change",
              source: "fill the destination"
            }
          ])
        ],
        { goal }
      )
      expect(plan.requirements[0].beforeChanges).toBe(true)
    }
  )

  it.each([
    "Read the account code and fill the destination.",
    "Fill the destination, then read the account code."
  ])("does not invent a read-first barrier: %s", (goal) => {
    expect(
      parseAgentTaskPlan([call([read])], { goal }).requirements[0].beforeChanges
    ).toBeUndefined()
  })

  it.each([
    "Read the account code and fill the destination.",
    "Fill the destination, then read the account code.",
    "Read the account code."
  ])("refuses a planner-invented ordering flag: %s", (goal) => {
    expect(() =>
      parseAgentTaskPlan([call([{ ...read, beforeChanges: true }])], { goal })
    ).toThrow(AgentDecisionFormatError)
  })

  it("retains check-then-fill ordering without a planner flag", () => {
    const text =
      "Check the lead time of each of the three suppliers linked on this page"
    const goal = `${text}, then fill in the purchase request with the supplier that has the shortest lead time and that lead time in days. Submit the request once.`
    expect(
      parseAgentTaskPlan([call([{ text, kind: "read", source: text }])], {
        goal
      }).requirements[0].beforeChanges
    ).toBe(true)
  })

  it("does not turn a checkbox command into a read phase", () => {
    const goal = "Check Agree, then fill Destination."
    expect(
      parseAgentTaskPlan(
        [
          call([{ text: "Check Agree", kind: "change", source: "Check Agree" }])
        ],
        { goal }
      ).requirements[0].beforeChanges
    ).toBeUndefined()
  })

  it("does not apply one read's ordering to independent reading", () => {
    const goal =
      "Read the account code, then fill the destination. Read the delivery policy."
    const plan = parseAgentTaskPlan(
      [
        call([
          read,
          {
            text: "Read the delivery policy",
            kind: "read",
            source: "Read the delivery policy"
          }
        ])
      ],
      { goal }
    )
    expect(plan.requirements.map(({ beforeChanges }) => beforeChanges)).toEqual(
      [true, undefined]
    )
  })

  it("keeps the barrier when an amendment omits or clears it", () => {
    const goal = "Read the account code, then fill the destination."
    const original = parseAgentTaskPlan(
      [call([{ ...read, beforeChanges: true }])],
      { goal }
    )
    const amended = parseAgentTaskPlan(
      [call([{ ...read, keep: "r1", beforeChanges: false }])],
      {
        goal,
        current: {
          requirements: original.requirements,
          constraints: [],
          issued: { requirements: 1, constraints: 0 }
        }
      }
    )
    expect(amended.requirements[0].beforeChanges).toBe(true)
  })
})
