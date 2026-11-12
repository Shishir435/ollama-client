import { describe, expect, it } from "vitest"
import type { ToolCall } from "@/lib/tools/types"
import { AgentDecisionFormatError } from "../agent-decision-parser"
import { parseAgentTaskPlan } from "../agent-plan"
import {
  agentCoverageRequirement,
  agentNamedValues,
  agentUncoveredValues
} from "../agent-plan-coverage"

const call = (arguments_: unknown): ToolCall => ({
  id: "plan",
  name: "agent_plan",
  arguments: arguments_ as ToolCall["arguments"]
})

describe("user reading obligations", () => {
  it.each(["change", "read", "constraint"])(
    "preserves review scope when the planner classifies it as %s",
    (kind) => {
      const source = "Review every application page"
      const review = {
        text: source,
        kind: kind === "constraint" ? "scope" : kind,
        source
      }
      const goal = `${source}. Fill Name with Ada. Do not submit.`
      const plan = parseAgentTaskPlan(
        [
          call({
            requirements: [
              {
                text: "Name holds Ada",
                kind: "change",
                source: "Fill Name with Ada"
              },
              ...(kind === "constraint" ? [] : [review])
            ],
            constraints: kind === "constraint" ? [review] : []
          })
        ],
        { goal, utterance: goal }
      )
      expect(plan.requirements).toContainEqual(
        expect.objectContaining({ text: source, kind: "read", source })
      )
      expect(plan.constraints).toContainEqual(
        expect.objectContaining({ forbids: ["submission"] })
      )
      expect(plan.constraints?.some((entry) => entry.text === source)).toBe(
        false
      )
    }
  )

  it("does not invent a review obligation for a fill-only request", () => {
    const goal = "Fill Name with Ada"
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            { text: "Name holds Ada", kind: "change", source: goal }
          ]
        })
      ],
      { goal, utterance: goal }
    )
    expect(plan.requirements).toHaveLength(1)
    expect(plan.requirements[0]?.kind).toBe("change")
  })

  it("preserves explicit ordering rather than reducing it to a bare read", () => {
    const goal = "Review every page before submitting"
    const plan = parseAgentTaskPlan(
      [call({ requirements: [{ text: goal, kind: "change", source: goal }] })],
      { goal }
    )
    expect(plan.requirements[0]).toMatchObject({
      text: goal,
      source: goal,
      kind: "change"
    })
  })

  it("keeps a read-only task and a reading scope restriction", () => {
    const goal = "Review the draft. Read only the first page."
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            {
              text: "Review the draft",
              kind: "change",
              source: "Review the draft"
            }
          ],
          constraints: [
            {
              text: "Read only the first page",
              kind: "scope",
              source: "Read only the first page"
            }
          ]
        })
      ],
      { goal }
    )
    expect(plan.requirements[0]?.kind).toBe("read")
    expect(plan.constraints).toContainEqual(
      expect.objectContaining({
        text: "Read only the first page",
        kind: "scope"
      })
    )
  })
})

describe("explicit control/value relationships", () => {
  const goal = "Set billing city to Pune. Set shipping city to Delhi."

  it("does not count swapped values as covered merely because all words appear", () => {
    const missing = agentUncoveredValues(
      goal,
      [
        { id: "r1", text: "Billing city holds Delhi", kind: "change" },
        { id: "r2", text: "Shipping city holds Pune", kind: "change" }
      ],
      []
    )
    expect(missing.map(({ control, value }) => [control, value])).toEqual([
      ["billing city", "Pune"],
      ["shipping city", "Delhi"]
    ])
  })

  it("keeps the target in a coverage requirement", () => {
    const named = agentNamedValues("Set shipping speed to Overnight")[0]
    expect(agentCoverageRequirement(named, "r1")).toMatchObject({
      text: "set shipping speed to Overnight",
      kind: "change"
    })
  })

  it("tracks the same value requested for two different controls", () => {
    const missing = agentUncoveredValues(
      "Set billing city to Pune. Set shipping city to Pune.",
      [{ id: "r1", text: "Billing city holds Pune", kind: "change" }],
      []
    )
    expect(missing).toMatchObject([{ control: "shipping city", value: "Pune" }])
  })

  it.each([
    "Do not set shipping city to Delhi",
    'Don\'t set shipping city to "Delhi"',
    "Never set shipping city to Delhi"
  ])(
    "does not add a forbidden assignment as requested work: %s",
    (instruction) => {
      expect(agentNamedValues(instruction)).toEqual([])
    }
  )

  it("binds a quoted value to the nearest assignment in a compound request", () => {
    expect(
      agentNamedValues('Set Billing to Pune and set Shipping to "Delhi"').map(
        ({ control, value }) => [control, value]
      )
    ).toEqual([
      ["Billing", "Pune"],
      ["Shipping", "Delhi"]
    ])
  })

  it.each(["field", "selected"])(
    "rejects a swapped %s predicate even with the entire request as its source",
    (type) => {
      expect(() =>
        parseAgentTaskPlan(
          [
            call({
              requirements: [
                {
                  text: "Billing city holds Pune",
                  kind: "change",
                  source: goal,
                  check: { type, name: "billing city", value: "Delhi" }
                }
              ]
            })
          ],
          { goal }
        )
      ).toThrow(AgentDecisionFormatError)
    }
  )

  it("does not let correct prose hide a contradictory typed predicate", () => {
    expect(
      agentUncoveredValues(
        goal,
        [
          {
            id: "r1",
            text: "Billing city holds Pune and shipping city holds Delhi",
            kind: "change",
            check: { type: "field", name: "billing city", value: "Delhi" }
          }
        ],
        []
      )
    ).toHaveLength(2)
  })

  it("checks original assignments even when the model's source reorders their words", () => {
    const source = "Set billing city to Delhi. Set shipping city to Pune."
    expect(() =>
      parseAgentTaskPlan(
        [
          call({
            requirements: [
              {
                text: "Billing city holds Delhi",
                kind: "change",
                source,
                check: { type: "field", name: "billing city", value: "Delhi" }
              }
            ]
          })
        ],
        { goal }
      )
    ).toThrow(AgentDecisionFormatError)
  })

  it("does not let a delegated goal override the user's explicit value", () => {
    const delegated = "Set billing city to Delhi"
    expect(() =>
      parseAgentTaskPlan(
        [
          call({
            requirements: [
              {
                text: "Billing city holds Delhi",
                kind: "change",
                source: delegated,
                check: { type: "field", name: "billing city", value: "Delhi" }
              }
            ]
          })
        ],
        { goal: delegated, utterance: "Set billing city to Pune" }
      )
    ).toThrow(AgentDecisionFormatError)
  })

  it("uses the latest user answer for a new assignment", () => {
    const latest = "Set billing city to Mumbai"
    const original = "Set billing city to Pune"
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            {
              text: "Billing city holds Mumbai",
              kind: "change",
              source: latest,
              check: { type: "field", name: "billing city", value: "Mumbai" }
            }
          ]
        })
      ],
      {
        goal: original,
        utterance: original,
        answers: [{ questionId: "q1", text: latest, answeredAt: 2 }]
      }
    )
    expect(plan.requirements[0]?.check).toMatchObject({ value: "Mumbai" })
    expect(plan.requirements).toHaveLength(1)
  })

  it("does not silently omit the replacement value from a user's answer", () => {
    expect(
      agentUncoveredValues(
        "Set billing city to Pune",
        [{ id: "r1", text: "Billing city holds Pune", kind: "change" }],
        [],
        ["Set billing city to Mumbai"]
      )
    ).toMatchObject([{ control: "billing city", value: "Mumbai" }])
  })

  it("accepts the requested bindings", () => {
    const plan = parseAgentTaskPlan(
      [
        call({
          requirements: [
            {
              text: "Billing city holds Pune",
              kind: "change",
              source: "Set billing city to Pune",
              check: { type: "field", name: "billing city", value: "Pune" }
            },
            {
              text: "Shipping city holds Delhi",
              kind: "change",
              source: "Set shipping city to Delhi",
              check: { type: "field", name: "shipping city", value: "Delhi" }
            }
          ]
        })
      ],
      { goal, utterance: goal }
    )
    expect(plan.requirements).toHaveLength(2)
  })

  it.each(["Hello, world!", "Résumé prêt — नमस्ते", "The Hague", "NY", "A"])(
    "keeps a quoted assignment whole: %s",
    (value) => {
      const source = `Set Message to "${value}"`
      expect(agentNamedValues(source)).toMatchObject([
        { control: "Message", value }
      ])
      const plan = parseAgentTaskPlan(
        [
          call({
            requirements: [
              {
                text: "Message holds the requested text",
                kind: "change",
                source,
                check: { type: "field", name: "Message", value }
              }
            ]
          })
        ],
        { goal: source, utterance: source }
      )
      expect(plan.requirements).toHaveLength(1)
    }
  )

  it("does not weaken a literal check by removing punctuation", () => {
    const source = 'Set Message to "Hello, world!"'
    expect(() =>
      parseAgentTaskPlan(
        [
          call({
            requirements: [
              {
                text: "Message holds the requested text",
                kind: "change",
                source,
                check: { type: "field", name: "Message", value: "Hello world" }
              }
            ]
          })
        ],
        { goal: source }
      )
    ).toThrow(AgentDecisionFormatError)
  })

  it.each(["$1,000", "12.50", "March 5, 2027", "St. Louis"])(
    "does not treat an unquoted punctuation prefix as the complete value: %s",
    (value) => {
      const source = `Set Value to ${value}`
      const plan = parseAgentTaskPlan(
        [
          call({
            requirements: [
              {
                text: `Value holds ${value}`,
                kind: "change",
                source,
                check: { type: "field", name: "Value", value }
              }
            ]
          })
        ],
        { goal: source, utterance: source }
      )
      expect(plan.requirements).toHaveLength(1)
      expect(plan.requirements[0]?.check).toMatchObject({ value })
    }
  )

  it("does not consider a short code covered by a different code", () => {
    expect(
      agentUncoveredValues(
        "Set Code to NY",
        [{ id: "r1", text: "Code holds NJ", kind: "change" }],
        []
      )
    ).toMatchObject([{ control: "Code", value: "NY" }])
  })

  it("accepts grouped assignments with explicitly named controls", () => {
    expect(
      agentUncoveredValues(
        goal,
        [
          {
            id: "r1",
            text: "The requested cities are filled",
            kind: "change",
            items: ["Billing city Pune", "Shipping city Delhi"]
          }
        ],
        []
      )
    ).toEqual([])
  })
})

describe("literal field coverage cannot be hidden by a narrower check", () => {
  it.each(["Enter Ada and select Blue", 'Enter "Ada" and select "Blue"'])(
    "requires Blue separately when a Name check narrows %s",
    (goal) => {
      expect(
        agentUncoveredValues(
          goal,
          [
            {
              id: "r1",
              text: "Enter Ada and select Blue",
              kind: "change",
              check: { type: "field", name: "Name", value: "Ada" }
            }
          ],
          []
        )
      ).toMatchObject([{ value: "Blue", verb: "select" }])
    }
  )
  it.each(["The End", "A", "Latest"])(
    "preserves the entire quoted action literal %s",
    (value) => {
      expect(agentNamedValues(`Enter "${value}"`)).toMatchObject([
        { value, verb: "enter" }
      ])
      expect(
        agentUncoveredValues(
          `Enter "${value}"`,
          [
            {
              id: "r1",
              text: `Name holds ${value}`,
              kind: "change",
              check: { type: "field", name: "Name", value }
            }
          ],
          []
        )
      ).toEqual([])
    }
  )
  it("does not read a quoted option label as an unspecified criterion", () => {
    expect(
      agentUncoveredValues(
        'Select "Latest"',
        [
          {
            id: "r1",
            text: "Name holds Ada",
            kind: "change",
            check: { type: "field", name: "Name", value: "Ada" }
          }
        ],
        []
      )
    ).toMatchObject([{ value: "Latest", quoted: true }])
  })
  it("does not let a constraint stand in for an affirmative assignment", () => {
    expect(
      agentUncoveredValues(
        "Select Blue",
        [],
        [
          {
            id: "c1",
            text: "Only Blue is allowed",
            kind: "scope"
          }
        ]
      )
    ).toMatchObject([{ value: "Blue", verb: "select" }])
  })
})
