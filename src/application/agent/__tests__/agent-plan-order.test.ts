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

  it("separates the read's subject from the change it is ordered before", () => {
    const text = "Read the account code before filling the destination"
    const goal = `${text}.`
    for (const beforeChanges of [undefined, true])
      expect(
        parseAgentTaskPlan(
          [
            call([
              {
                text,
                kind: "read",
                source: text,
                ...(beforeChanges ? { beforeChanges } : {})
              }
            ])
          ],
          { goal }
        ).requirements[0].beforeChanges
      ).toBe(true)
  })

  const amend = (
    proposal: unknown[],
    answer: string,
    goal = "Read the account code. Fill the destination."
  ) => {
    const original = parseAgentTaskPlan(
      [
        call([
          read,
          {
            text: "Fill the destination",
            kind: "change",
            source: "Fill the destination"
          }
        ])
      ],
      { goal }
    )
    expect(original.requirements[0].beforeChanges).toBeUndefined()
    return parseAgentTaskPlan([call(proposal)], {
      goal,
      answers: [{ questionId: "q1", text: answer, answeredAt: 2 }],
      current: {
        requirements: original.requirements,
        constraints: [],
        issued: { requirements: 2, constraints: 0 }
      }
    })
  }
  const fill = {
    text: "Fill the destination",
    kind: "change",
    source: "Fill the destination",
    keep: "r2"
  }

  it("adds a grounded ordering to a retained read, and refuses an ungrounded one", () => {
    expect(
      amend(
        [{ ...read, keep: "r1", beforeChanges: true }, fill],
        "Read the account code, then fill the destination."
      ).requirements[0].beforeChanges
    ).toBe(true)
    expect(() =>
      amend(
        [{ ...read, keep: "r1", beforeChanges: true }, fill],
        "Use the work account."
      )
    ).toThrow(AgentDecisionFormatError)
  })

  it("recovers an omitted ordering flag on a read an amendment adds", () => {
    const code = {
      text: "Read the billing code",
      kind: "read",
      source: "Read the billing code, then fill the destination."
    }
    const amended = amend(
      [{ ...read, keep: "r1" }, fill, code],
      "Read the billing code, then fill the destination."
    )
    expect(
      amended.requirements.find((entry) => entry.text === code.text)
        ?.beforeChanges
    ).toBe(true)
    // A retained read is not given an ordering the user did not add to it.
    expect(amended.requirements[0].beforeChanges).toBeUndefined()
  })
})
