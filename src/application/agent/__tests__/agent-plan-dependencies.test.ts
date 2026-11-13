import { AgentTaskPlanSchema } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import { parseAgentTaskPlan } from "../agent-plan"

const goal =
  "Compare the three hotels linked on this page and book the cheapest eligible one for Ada."
const read = {
  text: "Compare the three hotels linked on this page",
  kind: "read",
  source: goal
}
const booking = {
  text: "Book the cheapest eligible hotel for Ada",
  kind: "change",
  source: goal,
  requires: [read.text]
}
const call = (requirements: unknown[]): ToolCall => ({
  id: "plan",
  name: "agent_plan",
  arguments: { requirements }
})

describe("read dependencies of committed choices", () => {
  it("binds a comparison to a booking without inventing a read-before-all-edits phase", () => {
    const plan = parseAgentTaskPlan([call([read, booking])], { goal })
    expect(plan.requirements[0].beforeChanges).toBeUndefined()
    expect(plan.requirements[1].requires).toEqual(["r1"])
    expect(AgentTaskPlanSchema.parse(JSON.parse(JSON.stringify(plan)))).toEqual(
      plan
    )
  })
  it.each([["missing read"], ["r1"], [booking.text], [], "r1"])(
    "refuses an unresolved dependency: %j",
    (requires) => {
      expect(() =>
        parseAgentTaskPlan([call([read, { ...booking, requires }])], { goal })
      ).toThrow()
    }
  )
  it("refuses dependencies attached to a read, preventing cycles", () => {
    expect(() =>
      parseAgentTaskPlan(
        [call([{ ...read, requires: [booking.text] }, booking])],
        { goal }
      )
    ).toThrow()
  })
  it("keeps a retained change's dependencies when an amendment omits or replaces them", () => {
    const plan = parseAgentTaskPlan([call([read, booking])], { goal })
    const current = {
      requirements: plan.requirements,
      constraints: [],
      issued: { requirements: 2, constraints: 0 }
    }
    // An unresolvable replacement is refused rather than silently dropped.
    expect(() =>
      parseAgentTaskPlan(
        [
          call([
            read,
            { ...booking, keep: "r2", requires: ["invented replacement"] }
          ])
        ],
        { goal, current }
      )
    ).toThrow()
    for (const requires of [undefined, [], [read.text]]) {
      const amended = parseAgentTaskPlan(
        [call([read, { ...booking, keep: "r2", requires }])],
        {
          goal,
          current: {
            requirements: plan.requirements,
            constraints: [],
            issued: { requirements: 2, constraints: 0 }
          }
        }
      )
      expect(
        amended.requirements.find((entry) => entry.id === "r2")?.requires
      ).toEqual(["r1"])
    }
  })
  it("merges a dependency an amendment adds to a retained change", () => {
    const plan = parseAgentTaskPlan([call([read, booking])], { goal })
    const policy = {
      text: "Read the cancellation policy",
      kind: "read",
      source: "Also read the cancellation policy before booking."
    }
    const amended = parseAgentTaskPlan(
      [
        call([
          { ...read, keep: "r1" },
          policy,
          { ...booking, keep: "r2", requires: [read.text, policy.text] }
        ])
      ],
      {
        goal,
        answers: [
          {
            questionId: "q1",
            text: "Also read the cancellation policy before booking.",
            answeredAt: 2
          }
        ],
        current: {
          requirements: plan.requirements,
          constraints: [],
          issued: { requirements: 2, constraints: 0 }
        }
      }
    )
    const added = amended.requirements.find(
      (entry) => entry.text === policy.text
    )
    expect(
      amended.requirements.find((entry) => entry.id === "r2")?.requires
    ).toEqual(["r1", added?.id])
  })
  it("rejects persisted graph references to missing or change outcomes", () => {
    for (const id of ["missing", "r2"]) {
      expect(
        AgentTaskPlanSchema.safeParse({
          requirements: [
            { id: "r1", kind: "read", text: read.text },
            { id: "r2", kind: "change", text: booking.text, requires: [id] }
          ]
        }).success
      ).toBe(false)
    }
  })
})
