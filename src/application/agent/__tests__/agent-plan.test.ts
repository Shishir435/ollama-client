import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import { AgentDecisionFormatError } from "../agent-decision-parser"
import { AGENT_PLAN_TOOL, parseAgentTaskPlan } from "../agent-plan"

const call = (args: unknown): ToolCall => ({
  id: "call-1",
  name: "agent_plan",
  arguments: args as ToolCall["arguments"]
})

describe("parseAgentTaskPlan", () => {
  it("stamps its own ids rather than trusting the model's", () => {
    expect(
      parseAgentTaskPlan([
        call({
          requirements: [
            { text: "the name field holds Alice", kind: "change", id: "x" },
            { text: "the document is saved", kind: "change", id: "x" }
          ]
        })
      ]).requirements
    ).toEqual([
      { id: "r1", text: "the name field holds Alice", kind: "change" },
      { id: "r2", text: "the document is saved", kind: "change" }
    ])
  })

  /**
   * Every later reference to a requirement is a lookup by id — the completion
   * decision, the recorded outcome, the panel — so two sharing one is a
   * silent merge, and a model asked to invent them returns duplicates.
   */
  it("keeps ids unique across entries the model gave the same name", () => {
    const ids = parseAgentTaskPlan([
      call({
        requirements: [
          { text: "first", kind: "change" },
          { text: "second", kind: "change" },
          { text: "third", kind: "read" }
        ]
      })
    ]).requirements.map((requirement) => requirement.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("reads an unrecognised kind as a change", () => {
    expect(
      parseAgentTaskPlan([
        call({ requirements: [{ text: "submit it", kind: "mutate" }] })
      ]).requirements[0]?.kind
    ).toBe("change")
  })

  /**
   * Cut rather than refused: a model that answered well and wrote one
   * sentence too long has still answered, and refusing costs the run its
   * plan — which means the weaker judge — for a formatting reason.
   */
  it("cuts over-long text instead of refusing the plan", () => {
    const requirement = parseAgentTaskPlan([
      call({ requirements: [{ text: "x".repeat(500), kind: "change" }] })
    ]).requirements[0]
    expect(requirement?.text).toHaveLength(200)
  })

  it("drops entries with no text and refuses a plan left empty", () => {
    expect(() =>
      parseAgentTaskPlan([
        call({ requirements: [{ text: "   ", kind: "change" }] })
      ])
    ).toThrow(AgentDecisionFormatError)
  })

  it("refuses an answer that called something else", () => {
    expect(() =>
      parseAgentTaskPlan([{ ...call({}), name: "agent_decision" }])
    ).toThrow(AgentDecisionFormatError)
  })

  it("refuses an answer carrying no requirements array", () => {
    expect(() =>
      parseAgentTaskPlan([call({ requirements: "two things" })])
    ).toThrow(AgentDecisionFormatError)
  })

  it("offers the model only the two kinds the judge understands", () => {
    const items = AGENT_PLAN_TOOL.parameters.properties.requirements as {
      items: { properties: { kind: { enum: string[] } } }
    }
    expect(items.items.properties.kind.enum).toEqual(["change", "read"])
  })
})
