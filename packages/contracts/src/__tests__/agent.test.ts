import { describe, expect, it } from "vitest"
import {
  AGENT_GRANTABLE_EFFECTS,
  AGENT_RUN_STATUSES,
  AgentCommandSchema,
  AgentDecisionSchema,
  AgentErrorSchema,
  AgentGrantSchema,
  AgentObservationSchema,
  AgentRunStatusSchema,
  AgentStepStatusSchema,
  MAX_AGENT_OBSERVATIONS
} from ".."

const ground = { snapshotId: "snapshot-1", generation: 1 }

describe("agent contract ceilings", () => {
  it("gives a run room for a real task rather than a scripted one", () => {
    // One observation is counted per decision, so this is the step ceiling.
    // Twenty-five of them stopped runs that were one click from finishing.
    expect(MAX_AGENT_OBSERVATIONS).toBe(50)
  })

  it("lets a submission be pre-authorized, and nothing below it", () => {
    /**
     * Critical is never grantable, so as a critical class a submission was a
     * prompt no user could ever answer once — an agent asked to post ten
     * comments asked for ten final clicks. The floor is unmoved: nothing that
     * destroys, pays, authenticates or touches a sensitive control appears
     * here at any scope.
     */
    expect([...AGENT_GRANTABLE_EFFECTS]).toEqual([
      "activation",
      "form_mutation",
      "submission"
    ])
    expect(
      AgentGrantSchema.safeParse({
        origin: "https://example.com",
        effects: ["activation", "form_mutation", "submission"],
        grantedAt: 1
      }).success
    ).toBe(true)
    expect(
      AgentGrantSchema.safeParse({
        origin: "https://example.com",
        effects: ["destructive"],
        grantedAt: 1
      }).success
    ).toBe(false)
  })

  it("lets a failure keep the key the layer below already named it by", () => {
    expect(
      AgentErrorSchema.safeParse({
        code: "model_unavailable",
        message: "The local provider is busy with another request.",
        messageKey: "errors.provider.busy",
        retryable: true
      }).success
    ).toBe(true)
  })
})

describe("agent contract schemas", () => {
  it("accepts each supported command shape", () => {
    const commands = [
      { type: "read", ...ground },
      { type: "click", ref: "e1", ...ground },
      { type: "type", ref: "e1", text: "hello", ...ground },
      { type: "clear_and_type", ref: "e1", text: "hello", ...ground },
      { type: "replace_text", ref: "e1", find: "old", text: "", ...ground },
      { type: "drag", ref: "e1", to: "e2", ...ground },
      { type: "press_key", ref: "e1", key: "Enter", ...ground },
      { type: "select", ref: "e1", value: "one", ...ground },
      { type: "check", ref: "e1", ...ground },
      { type: "uncheck", ref: "e1", ...ground },
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
      frameId: 0,
      documentId: "document-1",
      url: "https://example.com",
      origin: "https://example.com",
      title: "Example",
      frames: [
        {
          frameId: 0,
          documentId: "document-1",
          origin: "https://example.com",
          url: "https://example.com",
          access: "ok",
          snapshotId: "snapshot-1",
          generation: 1
        }
      ],
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

  it("rejects destinations on elements the user cannot see", () => {
    const observation = {
      snapshotId: "snapshot-1",
      generation: 1,
      tabId: 7,
      frameId: 0,
      documentId: "document-1",
      url: "https://example.com",
      origin: "https://example.com",
      title: "Example",
      frames: [
        {
          frameId: 0,
          documentId: "document-1",
          origin: "https://example.com",
          url: "https://example.com",
          access: "ok",
          snapshotId: "snapshot-1",
          generation: 1
        }
      ],
      elements: [
        {
          ref: "hidden-link",
          frameId: 0,
          tag: "a",
          href: "https://example.com/hidden",
          visible: false,
          enabled: true,
          editable: false,
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
    expect(
      AgentObservationSchema.safeParse({
        ...observation,
        elements: [{ ...observation.elements[0], visible: true }]
      }).success
    ).toBe(true)
  })

  it("rejects unknown run and step statuses", () => {
    expect(AgentRunStatusSchema.safeParse("uncertain").success).toBe(false)
    expect(AgentStepStatusSchema.safeParse("running").success).toBe(false)
    expect(AGENT_RUN_STATUSES).not.toContain("uncertain")
  })
})
