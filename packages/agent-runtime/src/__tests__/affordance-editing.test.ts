import type {
  AgentCommand,
  AgentElement,
  AgentObservation
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import { agentAffordanceFeedback, classifyAgentAffordance } from "../affordance"
import { evaluateAgentPolicy } from "../policy"
import type { ResolvedAgentEffect } from "../ports"

/**
 * Editing and dragging, as the classifier and policy see them: what a field
 * may receive, where an edit is grounded, what a drag needs on both ends, and
 * how a drop and a file chooser are priced.
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

const observation = (elements: AgentElement[]): AgentObservation => ({
  snapshotId: "snapshot-1",
  generation: 1,
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
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
  elements,
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
})

const command = (partial: Record<string, unknown>) =>
  ({
    snapshotId: "snapshot-1",
    generation: 1,
    ref: "e1",
    ...partial
  }) as AgentCommand

describe("editor affordances", () => {
  it("accepts typed text into an editing host and refuses it into a plain div", () => {
    expect(
      classifyAgentAffordance(
        command({ type: "type", text: "hi" }),
        observation([element()])
      )
    ).toBeUndefined()
    expect(
      classifyAgentAffordance(
        command({ type: "type", text: "hi" }),
        observation([element({ type: undefined, editable: false })])
      )?.reason
    ).toBe("not_text_field")
  })

  it("refuses a line break into a single-line field and says how to confirm instead", () => {
    const refused = classifyAgentAffordance(
      command({ type: "type", text: "a\nb" }),
      observation([element({ multiline: undefined })])
    )
    expect(refused?.reason).toBe("newline_in_single_line")
    expect(agentAffordanceFeedback(refused as never)).toContain("press_key")
    expect(
      classifyAgentAffordance(
        command({ type: "clear_and_type", text: "a\nb" }),
        observation([
          element({ tag: "input", type: "text", multiline: undefined })
        ])
      )?.reason
    ).toBe("newline_in_single_line")
    expect(
      classifyAgentAffordance(
        command({ type: "type", text: "a\nb" }),
        observation([element({ tag: "textarea", type: "textarea" })])
      )
    ).toBeUndefined()
  })

  it("grounds a replacement in the observed value, once", () => {
    expect(
      classifyAgentAffordance(
        command({ type: "replace_text", find: "world", text: "there" }),
        observation([element()])
      )
    ).toBeUndefined()
    expect(
      classifyAgentAffordance(
        command({ type: "replace_text", find: "nope", text: "there" }),
        observation([element()])
      )?.reason
    ).toBe("text_not_found")
    expect(
      classifyAgentAffordance(
        command({ type: "replace_text", find: "l", text: "L" }),
        observation([element()])
      )?.reason
    ).toBe("text_ambiguous")
    /* A sensitive field shows no value; policy hands the step over anyway. */
    expect(
      classifyAgentAffordance(
        command({ type: "replace_text", find: "x", text: "y" }),
        observation([
          element({
            tag: "input",
            type: "password",
            sensitive: true,
            value: undefined
          })
        ])
      )
    ).toBeUndefined()
  })

  it("lets a file input be clicked so policy can hand the chooser to the user", () => {
    expect(
      classifyAgentAffordance(
        command({ type: "click" }),
        observation([
          element({
            tag: "input",
            type: "file",
            sensitive: true,
            value: undefined,
            multiline: undefined
          })
        ])
      )
    ).toBeUndefined()
  })
})

describe("drag affordances", () => {
  const item = element({
    ref: "e1",
    tag: "li",
    type: undefined,
    value: undefined,
    editable: false,
    multiline: undefined,
    draggable: true,
    name: "Task A"
  })
  const column = element({
    ref: "e2",
    tag: "ul",
    type: undefined,
    value: undefined,
    editable: false,
    multiline: undefined,
    role: "list",
    name: "Done"
  })

  it("accepts a visible destination in the same frame and refuses every other", () => {
    expect(
      classifyAgentAffordance(
        command({ type: "drag", to: "e2" }),
        observation([item, column])
      )
    ).toBeUndefined()
    expect(
      classifyAgentAffordance(
        command({ type: "drag", to: "e9" }),
        observation([item, column])
      )
    ).toEqual({ reason: "unknown_destination", ref: "e9" })
    expect(
      classifyAgentAffordance(
        command({ type: "drag", to: "e2" }),
        observation([item, { ...column, visible: false }])
      )?.reason
    ).toBe("hidden_destination")
    expect(
      classifyAgentAffordance(
        command({ type: "drag", to: "e1" }),
        observation([item, column])
      )?.reason
    ).toBe("drag_onto_itself")
    const framed = observation([item, { ...column, ref: "f3e1", frameId: 3 }])
    framed.frames.push({
      frameId: 3,
      parentFrameId: 0,
      documentId: "document-3",
      origin: "https://example.com",
      url: "https://example.com/frame",
      access: "ok",
      snapshotId: "snapshot-3",
      generation: 1
    })
    expect(
      classifyAgentAffordance(command({ type: "drag", to: "f3e1" }), framed)
        ?.reason
    ).toBe("cross_frame_drag")
  })

  it("names the destination ref in every drag refusal", () => {
    for (const reason of [
      "unknown_destination",
      "hidden_destination",
      "cross_frame_drag",
      "drag_onto_itself"
    ] as const) {
      expect(agentAffordanceFeedback({ reason, ref: "e2" })).toContain(
        'Ref "e2"'
      )
    }
  })
})

describe("editing and drag policy", () => {
  const effect = (
    semanticEffects: ResolvedAgentEffect["semanticEffects"]
  ): ResolvedAgentEffect => ({
    command: command({ type: "drag", to: "e2" }),
    target: { sensitive: false, maySubmit: false, accessibleName: "Task A" },
    semanticEffects,
    snapshotIdentity: {
      snapshotId: "snapshot-1",
      generation: 1,
      tabId: 7,
      frameId: 0,
      documentId: "document-1"
    },
    sourceUrl: "https://example.com/",
    sourceOrigin: "https://example.com"
  })
  const decide = (
    resolved: ResolvedAgentEffect,
    grants?: {
      origin: string
      effects: ("activation" | "form_mutation")[]
      grantedAt: number
    }[]
  ) =>
    evaluateAgentPolicy({
      runId: "run-1",
      stepId: "step-1",
      effect: resolved,
      allowedOrigins: ["https://example.com"],
      scopedTabIds: [7],
      ...(grants ? { grants } : {}),
      now: 100
    })

  it("asks approval for every drag and never offers or spends a grant on one", () => {
    const decision = decide(effect(["drag"]))
    expect(decision.type).toBe("approval_required")
    expect(decision.risk).toBe("high")
    if (decision.type === "approval_required") {
      expect(decision.request.grantable).toBeUndefined()
    }
    expect(
      decide(effect(["drag"]), [
        {
          origin: "https://example.com",
          effects: ["activation", "form_mutation"],
          grantedAt: 1
        }
      ]).type
    ).toBe("approval_required")
  })

  it("hands a file chooser to the user as a file upload takeover", () => {
    const decision = decide(effect(["file_selection"]))
    expect(decision.type).toBe("takeover_required")
    if (decision.type === "takeover_required") {
      expect(decision.request.reason).toBe("file_upload")
      expect(decision.request.instruction).toContain("choose the file")
    }
  })
})
