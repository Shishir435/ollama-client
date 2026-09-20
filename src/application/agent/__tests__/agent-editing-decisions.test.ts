import type { AgentElement, AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import {
  AGENT_DECISION_TOOL_NAME,
  parseAgentDecisionToolCalls
} from "../agent-decision-parser"
import { AGENT_DECISION_TOOL } from "../agent-model-port"
import { projectAgentElement } from "../agent-observation-projection"

/**
 * The editing and drag commands as the model meets them: offered by the tool,
 * accepted by the parser with their own fields, and told about a field's
 * shape in the projection.
 */

const element = (overrides: Partial<AgentElement> = {}): AgentElement => ({
  ref: "e1",
  frameId: 0,
  tag: "div",
  type: "contenteditable",
  value: "Hello world",
  visible: true,
  enabled: true,
  editable: true,
  sensitive: false,
  multiline: true,
  ...overrides
})

const observation: AgentObservation = {
  snapshotId: "snapshot-2",
  generation: 2,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  url: "https://example.com/",
  origin: "https://example.com",
  title: "Example",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      url: "https://example.com/",
      access: "ok",
      snapshotId: "snapshot-2",
      generation: 2
    }
  ],
  elements: [
    element(),
    element({
      ref: "e2",
      tag: "li",
      type: undefined,
      value: undefined,
      editable: false,
      multiline: undefined,
      draggable: true,
      name: "Task A"
    }),
    element({
      ref: "e3",
      tag: "ul",
      role: "list",
      type: undefined,
      value: undefined,
      editable: false,
      multiline: undefined,
      name: "Done"
    })
  ],
  visibleText: "",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  },
  dialogs: [],
  capturedAt: 1
}

const decide = (args: Record<string, unknown>) =>
  parseAgentDecisionToolCalls(
    [{ id: "c1", name: AGENT_DECISION_TOOL_NAME, arguments: args }],
    observation
  )

describe("editing decisions", () => {
  it("offers replace_text and drag with their fields", () => {
    const properties = AGENT_DECISION_TOOL.parameters.properties as Record<
      string,
      { enum?: string[] }
    >
    expect(properties.type.enum).toEqual(
      expect.arrayContaining(["replace_text", "drag"])
    )
    expect(properties.find).toBeDefined()
    expect(properties.to).toBeDefined()
  })

  it("keeps find and to on their commands and grounds them", () => {
    expect(
      decide({ type: "replace_text", ref: "e1", find: "world", text: "there" })
    ).toEqual({
      type: "command",
      command: {
        type: "replace_text",
        ref: "e1",
        find: "world",
        text: "there",
        snapshotId: "snapshot-2",
        generation: 2
      }
    })
    expect(decide({ type: "drag", ref: "e2", to: "e3" })).toEqual({
      type: "command",
      command: {
        type: "drag",
        ref: "e2",
        to: "e3",
        snapshotId: "snapshot-2",
        generation: 2
      }
    })
    expect(() =>
      decide({ type: "replace_text", ref: "e1", find: "nope", text: "x" })
    ).toThrow(/text_not_found/)
    expect(() => decide({ type: "drag", ref: "e2", to: "e9" })).toThrow(
      /unknown_destination/
    )
  })

  it("projects a field's shape and a drag mark, and nothing at their defaults", () => {
    expect(projectAgentElement(element())).toMatchObject({
      type: "contenteditable",
      editable: true,
      multiline: true
    })
    expect(projectAgentElement(observation.elements[1])).toMatchObject({
      draggable: true
    })
    expect(
      projectAgentElement(element({ multiline: undefined }))
    ).not.toHaveProperty("multiline")
    expect(projectAgentElement(element())).not.toHaveProperty("draggable")
  })
})
