import type { AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  AGENT_DECISION_TOOL_NAME,
  AgentDecisionFormatError,
  parseAgentDecisionToolCalls
} from "../agent-decision-parser"

const observation: AgentObservation = {
  snapshotId: "snapshot-2",
  generation: 2,
  tabId: 7,
  documentId: "document-1",
  url: "https://example.com/",
  origin: "https://example.com",
  title: "Example",
  elements: [],
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

const call = (argumentsValue: Record<string, unknown>) => ({
  id: "call-1",
  name: AGENT_DECISION_TOOL_NAME,
  arguments: argumentsValue
})

describe("parseAgentDecisionToolCalls", () => {
  it("binds flat intent to the current observation without model-generated identity", () => {
    expect(
      parseAgentDecisionToolCalls(
        [call({ type: "click", ref: "e1" })],
        observation
      )
    ).toEqual({
      type: "command",
      command: {
        type: "click",
        ref: "e1",
        snapshotId: "snapshot-2",
        generation: 2
      }
    })
    expect(() =>
      parseAgentDecisionToolCalls([call({ type: "click" })], observation)
    ).toThrow("invalid decision")
    expect(() =>
      parseAgentDecisionToolCalls(
        [call({ type: "click", ref: "e1", generation: 1 })],
        observation
      )
    ).toThrow("stale snapshot")
  })

  it("accepts exactly one schema-valid grounded decision", () => {
    expect(
      parseAgentDecisionToolCalls(
        [
          call({
            type: "command",
            command: {
              type: "read",
              snapshotId: "snapshot-2",
              generation: 2
            }
          })
        ],
        observation
      )
    ).toMatchObject({ type: "command", command: { type: "read" } })
  })

  it.each([
    { calls: [] },
    {
      calls: [
        call({ type: "complete", summary: "Done" }),
        call({ type: "complete", summary: "Again" })
      ]
    }
  ])("rejects zero or multiple decisions", ({ calls }) => {
    expect(() => parseAgentDecisionToolCalls(calls, observation)).toThrow(
      AgentDecisionFormatError
    )
  })

  it("rejects unknown tool names", () => {
    expect(() =>
      parseAgentDecisionToolCalls(
        [{ ...call({ type: "complete", summary: "Done" }), name: "click" }],
        observation
      )
    ).toThrow("unknown agent tool")
  })

  it("rejects malformed and stale decisions", () => {
    expect(() =>
      parseAgentDecisionToolCalls([call({ type: "complete" })], observation)
    ).toThrow("invalid decision")
    expect(() =>
      parseAgentDecisionToolCalls(
        [
          call({
            type: "command",
            command: {
              type: "read",
              snapshotId: "snapshot-1",
              generation: 1
            }
          })
        ],
        observation
      )
    ).toThrow("stale snapshot")
  })

  it("accepts the flat shape the tool advertises", () => {
    // The published schema offers every variant's field, so a model may fill
    // the ones it did not choose.
    expect(
      parseAgentDecisionToolCalls(
        [
          {
            id: "call-1",
            name: AGENT_DECISION_TOOL_NAME,
            arguments: {
              type: "complete",
              summary: "The save button is now pressed.",
              question: "",
              reason: "",
              command: null
            }
          }
        ],
        observation
      )
    ).toEqual({ type: "complete", summary: "The save button is now pressed." })
  })

  it("still rejects a variant with nothing in its own field", () => {
    expect(() =>
      parseAgentDecisionToolCalls(
        [
          {
            id: "call-1",
            name: AGENT_DECISION_TOOL_NAME,
            arguments: { type: "complete", summary: "" }
          }
        ],
        observation
      )
    ).toThrow(AgentDecisionFormatError)
  })

  it("rejects an empty argument object, whatever produced it", () => {
    expect(() =>
      parseAgentDecisionToolCalls(
        [{ id: "call-1", name: AGENT_DECISION_TOOL_NAME, arguments: {} }],
        observation
      )
    ).toThrow(AgentDecisionFormatError)
  })
})
