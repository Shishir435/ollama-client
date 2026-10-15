import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import {
  AgentPlanCoverageError,
  agentPlanPrompt,
  parseAgentTaskPlan
} from "../agent-plan"
import { agentNamedValues, agentUncoveredValues } from "../agent-plan-coverage"

const call = (args: unknown): ToolCall => ({
  id: "call-1",
  name: "agent_plan",
  arguments: args as ToolCall["arguments"]
})

describe("values the user named", () => {
  it.each([
    ["Enter Ada and select Blue", ["Ada", "Blue"]],
    [
      'Search for "noise cancelling headphones"',
      ["noise cancelling headphones"]
    ],
    ["Set the shipping speed to Overnight", ["Overnight"]],
    ["Pick the 2 pm slot", ["2 pm slot"]],
    ["Type 'hello there' in the reply box", ["hello there"]],
    ["Choose Express, then pay", ["Express"]]
  ])("reads %s", (utterance, values) => {
    expect(agentNamedValues(utterance).map((named) => named.value)).toEqual(
      values
    )
  })

  it.each([
    "What's the weather in Paris?",
    "Check whether the order shipped",
    "Find the cheapest flight and tell me the price",
    "Don't submit it yet",
    "Open https://example.com/select/blue?type=x"
  ])("finds nothing to cover in %s", (utterance) => {
    expect(agentNamedValues(utterance)).toEqual([])
  })

  it("counts a value the plan carries in an item, a check or a limit", () => {
    expect(
      agentUncoveredValues(
        "Enter Ada, select Blue and choose Express",
        [
          {
            id: "r1",
            text: "The form holds the values",
            kind: "change",
            items: ["Name Ada"]
          },
          {
            id: "r2",
            text: "Colour is chosen",
            kind: "change",
            check: { type: "selected", name: "Colour", value: "Blue" }
          }
        ],
        [{ id: "c1", text: "Use Express shipping", kind: "scope" }]
      )
    ).toEqual([])
  })
})

describe("planning from the user's own message", () => {
  const goal = "Fill in the form with the name Ada"
  const utterance = "enter Ada and select Blue"

  it("refuses a plan that left a named value out, naming it", () => {
    let error: unknown
    try {
      parseAgentTaskPlan(
        [
          call({
            requirements: [
              { text: "Name holds Ada", kind: "change", source: "enter Ada" }
            ]
          })
        ],
        { goal, utterance }
      )
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(AgentPlanCoverageError)
    expect((error as AgentPlanCoverageError).feedback).toContain('"Blue"')
  })

  it("keeps the omission as work of its own when it is left out again", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            { text: "Name holds Ada", kind: "change", source: "enter Ada" }
          ]
        })
      ],
      { goal, utterance, coverageAsked: true }
    )
    expect(plan.requirements).toEqual([
      expect.objectContaining({ id: "r1", origin: "user" }),
      expect.objectContaining({
        id: "r2",
        text: "select Blue",
        kind: "change",
        source: "enter Ada and select Blue",
        origin: "coverage"
      })
    ])
  })

  it("lets an entry quote the user's message, and says whose words it rests on", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            { text: "Name holds Ada", kind: "change", source: "enter Ada" },
            {
              text: "Colour is Blue",
              kind: "change",
              source: "select Blue"
            },
            {
              text: "The form is filled in",
              kind: "change",
              source: "Fill in the form"
            }
          ]
        })
      ],
      { goal, utterance }
    )
    expect(plan.requirements.map((entry) => entry.origin)).toEqual([
      "user",
      "user",
      "delegated"
    ])
  })

  it("keeps a limit the chat model's paraphrase dropped", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            {
              text: "A car is booked for Friday",
              kind: "change",
              source: "Book a rental car for Friday"
            }
          ]
        })
      ],
      {
        goal: "Book a rental car for Friday",
        utterance: "Book me a rental car for Friday, without insurance."
      }
    )
    expect(plan.constraints).toEqual([
      expect.objectContaining({ kind: "exclude", origin: "user" })
    ])
    expect(plan.constraints?.[0]?.text).toContain("without insurance")
  })

  it("leaves origin out when there is no message to compare with", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            { text: "Name holds Ada", kind: "change", source: "name Ada" }
          ]
        })
      ],
      { goal }
    )
    expect(plan.requirements[0]?.origin).toBeUndefined()
  })

  it("shows the planner the message beside the goal, as data", () => {
    const prompt = agentPlanPrompt(goal, undefined, { utterance })
    expect(prompt).toContain("chat assistant wrote it")
    expect(prompt).toContain(JSON.stringify({ userMessage: utterance }))
  })
})

describe("words that are not values", () => {
  it.each([
    "Find the account type and tell me the owner",
    "Press Enter and wait for the results",
    "Sort by type and show me the newest"
  ])("finds nothing in %s", (utterance) => {
    expect(agentNamedValues(utterance)).toEqual([])
  })
})

it("reads a criterion as a criterion, not a value", () => {
  expect(
    agentUncoveredValues(
      "Pick the right account and report the selected account.",
      [{ id: "r1", kind: "read", text: "report the selected account" }],
      []
    )
  ).toEqual([])
})
