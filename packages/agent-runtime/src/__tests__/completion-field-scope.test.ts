import type {
  AgentObservation,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  judgeAgentCompletion,
  agentWorkflowReceiptSupport
} from "../completion"
import type { AgentStepReadout } from "../ports"

const page: AgentObservation = {
  snapshotId: "s",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "d",
  url: "https://example.com/application",
  origin: "https://example.com",
  title: "Application",
  frames: [
    {
      frameId: 0,
      documentId: "d",
      origin: "https://example.com",
      url: "https://example.com/application",
      access: "ok",
      snapshotId: "s",
      generation: 1
    }
  ],
  elements: [
    {
      ref: "e1",
      frameId: 0,
      tag: "input",
      name: "Name",
      value: "Ada",
      visible: true,
      enabled: true,
      editable: true,
      sensitive: false
    },
    {
      ref: "e2",
      frameId: 0,
      tag: "select",
      name: "Color",
      value: "Red",
      options: [
        { value: "Red", label: "Red", disabled: false },
        { value: "Blue", label: "Blue", disabled: false }
      ],
      visible: true,
      enabled: true,
      editable: false,
      sensitive: false
    },
    {
      ref: "e3",
      frameId: 0,
      tag: "input",
      name: "Agree",
      checked: false,
      visible: true,
      enabled: true,
      editable: false,
      sensitive: false
    }
  ],
  visibleText: "Name Color Agree",
  dialogs: [],
  capturedAt: 1,
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    documentWidth: 800,
    documentHeight: 600
  }
}
const batch: AgentStepReadout = {
  runId: "r",
  stepId: "r:1",
  sequence: 1,
  status: "verified",
  at: 1,
  requirementId: "r1",
  mutating: true,
  command: {
    type: "fill_form",
    snapshotId: "s",
    generation: 1,
    fields: [{ type: "clear_and_type", ref: "e1", text: "Ada" }]
  },
  verification: {
    outcome: "confirmed",
    evidence: {
      kind: "fields",
      observedAt: 1,
      summary: "Name holds the resolved value",
      fields: [{ name: "Name" }]
    }
  }
}
const single: AgentStepReadout = {
  ...batch,
  command: {
    type: "clear_and_type",
    snapshotId: "s",
    generation: 1,
    ref: "e1",
    text: "Ada"
  },
  target: { ref: "e1", tag: "input", name: "Name" },
  verification: {
    outcome: "confirmed",
    evidence: {
      kind: "field",
      observedAt: 1,
      summary: "Name holds the resolved value"
    }
  }
}
const requirement = (check: boolean): AgentTaskRequirement => ({
  id: "r1",
  kind: "change",
  text: "Set Name to Ada, Color to Blue, and Agree checked",
  ...(check
    ? { check: { type: "field", name: "Name", value: "Ada" } as const }
    : {})
})

describe("a field receipt cannot prove an entire form", () => {
  for (const receipt of [batch, single, { ...batch, heldPlannedValue: true }]) {
    for (const checked of [false, true]) {
      it(`${receipt.command?.type}, typed check ${checked}: wrong and missing fields need their own proof`, () => {
        const req = requirement(checked)
        for (const observation of [
          page,
          { ...page, elements: page.elements.slice(0, 1) }
        ]) {
          for (const evidence of [undefined, "Ada"]) {
            const result = judgeAgentCompletion({
              observation,
              steps: [receipt],
              requirements: [req],
              outcomes: [
                { id: "r1", met: true, ...(evidence ? { evidence } : {}) }
              ]
            })
            expect(result.type).toBe("refused")
          }
          expect(
            agentWorkflowReceiptSupport(
              req,
              undefined,
              [receipt],
              observation,
              new Set()
            )
          ).toBeUndefined()
        }
      })
    }
  }

  it.each([batch, single])(
    "still verifies an atomic Name requirement from $command.type",
    (receipt) => {
      expect(
        judgeAgentCompletion({
          observation: page,
          steps: [receipt],
          requirements: [
            {
              id: "r1",
              kind: "change",
              text: "Set Name to Ada",
              check: { type: "field", name: "Name", value: "Ada" }
            }
          ],
          outcomes: [{ id: "r1", met: true }]
        })
      ).toMatchObject({ type: "accepted" })
    }
  )
})

it("verifies every separate field obligation and refuses a wrong field", () => {
  const requirements: AgentTaskRequirement[] = [
    {
      id: "r1",
      kind: "change",
      text: "Name holds Ada",
      check: { type: "field", name: "Name", value: "Ada" }
    },
    {
      id: "r2",
      kind: "change",
      text: "Color is Blue",
      check: { type: "selected", name: "Color", value: "Blue" }
    },
    {
      id: "r3",
      kind: "change",
      text: "Agree is checked",
      check: { type: "checked", name: "Agree", checked: true }
    }
  ]
  const correct = {
    ...page,
    elements: page.elements.map((element) =>
      element.name === "Color"
        ? { ...element, value: "Blue" }
        : element.name === "Agree"
          ? { ...element, checked: true }
          : element
    )
  }
  const outcomes = requirements.map(({ id }) => ({ id, met: true }))
  expect(
    judgeAgentCompletion({
      observation: correct,
      steps: [batch],
      requirements,
      outcomes
    })
  ).toMatchObject({
    type: "accepted",
    outcome: { met: ["r1", "r2", "r3"], unmet: [] }
  })
  for (const missing of [false, true])
    expect(
      judgeAgentCompletion({
        observation: {
          ...correct,
          elements: missing
            ? correct.elements.filter((element) => element.name !== "Color")
            : correct.elements.map((element) =>
                element.name === "Color"
                  ? { ...element, value: "Red" }
                  : element
              )
        },
        steps: [batch],
        requirements,
        outcomes
      }).type
    ).toBe("refused")
})
