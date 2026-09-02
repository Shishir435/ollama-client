import { describe, expect, it } from "vitest"
import {
  AGENT_RUN_STATUSES,
  AgentCommandSchema,
  AgentDecisionSchema,
  AgentObservationSchema,
  AgentRunStatusSchema,
  AgentStepStatusSchema
} from ".."

const ground = { snapshotId: "snapshot-1", generation: 1 }

describe("agent contract schemas", () => {
  it("accepts each supported command shape", () => {
    const commands = [
      { type: "click", ref: "e1", ...ground },
      { type: "type", ref: "e1", text: "hello", ...ground },
      { type: "press_key", ref: "e1", key: "Enter", ...ground },
      { type: "select", ref: "e1", value: "one", ...ground },
      { type: "check", ref: "e1", checked: true, ...ground },
      { type: "scroll", direction: "down", ...ground },
      { type: "navigate", url: "https://example.com/path", ...ground },
      { type: "back", ...ground },
      { type: "forward", ...ground },
      { type: "open_tab", url: "https://example.com", ...ground },
      { type: "switch_tab", tabId: 7, ...ground },
      { type: "wait", condition: "Results appear", timeoutMs: 5_000, ...ground }
    ]

    for (const command of commands) {
      expect(AgentCommandSchema.safeParse(command).success).toBe(true)
    }
  })

  it("rejects arbitrary JavaScript commands", () => {
    expect(
      AgentCommandSchema.safeParse({
        type: "javascript",
        script: "document.body.remove()",
        ...ground
      }).success
    ).toBe(false)
  })

  it("rejects batch decisions containing multiple commands", () => {
    expect(
      AgentDecisionSchema.safeParse({
        type: "command",
        commands: [
          { type: "back", ...ground },
          { type: "forward", ...ground }
        ]
      }).success
    ).toBe(false)
  })

  it("rejects observations without snapshot identity", () => {
    expect(
      AgentObservationSchema.safeParse({
        url: "https://example.com",
        origin: "https://example.com",
        title: "Example",
        elements: [],
        visibleText: "Example",
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
      }).success
    ).toBe(false)
  })

  it("rejects sensitive element values", () => {
    const observation = {
      snapshotId: "snapshot-1",
      generation: 1,
      tabId: 7,
      documentId: "document-1",
      url: "https://example.com",
      origin: "https://example.com",
      title: "Example",
      elements: [
        {
          ref: "password",
          frameId: 0,
          tag: "input",
          type: "password",
          value: "secret",
          visible: true,
          enabled: true,
          editable: true,
          sensitive: true
        }
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

    expect(AgentObservationSchema.safeParse(observation).success).toBe(false)
  })

  it("rejects unknown run and step statuses", () => {
    expect(AgentRunStatusSchema.safeParse("uncertain").success).toBe(false)
    expect(AgentStepStatusSchema.safeParse("running").success).toBe(false)
    expect(AGENT_RUN_STATUSES).not.toContain("uncertain")
  })
})
