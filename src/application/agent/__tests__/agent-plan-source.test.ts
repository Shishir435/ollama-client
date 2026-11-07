import { MAX_AGENT_REQUIREMENT_SOURCE_CHARS } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import { AgentDecisionFormatError } from "../agent-decision-parser"
import { agentPlanPrompt, parseAgentTaskPlan } from "../agent-plan"

const call = (args: unknown): ToolCall => ({
  id: "call-1",
  name: "agent_plan",
  arguments: args as ToolCall["arguments"]
})

const utterance =
  "Compare the offers on all linked source pages and report their reference codes and the cheapest eligible offer. Exclude Archive; stay under 90 credits."
const goal =
  "Compare the offers on all linked source pages on the current Qualification application page. Exclude Archive and stay under 90 credits. Report each offer’s reference code and identify the cheapest eligible offer without submitting anything."

/** The request's own goal heading, as the planner copied it. */
const goalHeading = agentPlanPrompt(goal, undefined, { utterance }).split(
  "\n"
)[0]

const readRequirement = {
  text: "Report each offer's reference code and the cheapest eligible offer.",
  kind: "read",
  source: utterance
}

describe("a source is judged whole and kept as the clause that quotes", () => {
  it("accepts a heading-prefixed goal over the cap, keeping the clause that asks", () => {
    expect(goalHeading.length + goal.length).toBeGreaterThan(
      MAX_AGENT_REQUIREMENT_SOURCE_CHARS
    )
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [readRequirement],
          constraints: [
            {
              text: "Do not submit anything.",
              kind: "exclude",
              source: `${goalHeading} ${goal}`
            }
          ]
        })
      ],
      { goal, utterance }
    )
    const constraint = plan.constraints?.find(
      (entry) => entry.text === "Do not submit anything."
    )
    expect(constraint).toEqual(
      expect.objectContaining({
        source:
          "Report each offer’s reference code and identify the cheapest eligible offer without submitting anything.",
        origin: "delegated",
        forbids: ["submission"]
      })
    )
    expect(constraint?.source?.length).toBeLessThanOrEqual(
      MAX_AGENT_REQUIREMENT_SOURCE_CHARS
    )
  })

  it("takes the request's heading out of a source that fits", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            {
              text: "the hours are reported",
              kind: "read",
              source: "The user's goal: Find the opening hours"
            }
          ]
        })
      ],
      { goal: "Find the opening hours" }
    )
    expect(plan.requirements[0]?.source).toBe("Find the opening hours")
  })

  it("keeps a whole quote that fits, several sentences and all", () => {
    const plan = parseAgentTaskPlan(
      [call({ requirements: [readRequirement] })],
      { goal, utterance }
    )
    expect(plan.requirements[0]?.source).toBe(utterance)
    expect(plan.requirements[0]?.origin).toBe("user")
  })

  it("still refuses a long quote none of whose clauses asks for the entry", () => {
    const attempt = () =>
      parseAgentTaskPlan(
        [
          call({
            requirements: [readRequirement],
            constraints: [
              {
                text: "Do not download files.",
                kind: "exclude",
                source: `${goalHeading} ${goal}`
              }
            ]
          })
        ],
        { goal, utterance }
      )
    expect(attempt).toThrow(AgentDecisionFormatError)
    try {
      attempt()
    } catch (error) {
      expect((error as AgentDecisionFormatError).feedback).toContain(
        `at most ${MAX_AGENT_REQUIREMENT_SOURCE_CHARS} characters`
      )
    }
  })

  it("never accepts the heading alone as the user's words", () => {
    expect(() =>
      parseAgentTaskPlan(
        [
          call({
            requirements: [
              {
                text: "the message is reported",
                kind: "read",
                source: goalHeading
              }
            ]
          })
        ],
        { goal, utterance }
      )
    ).toThrow(AgentDecisionFormatError)
  })
})
