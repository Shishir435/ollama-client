import type {
  AgentCommand,
  AgentElement,
  AgentObservation
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import { agentAffordanceFeedback, classifyAgentAffordance } from "../affordance"
import { evaluateAgentPolicy } from "../policy"

const element = (overrides: Partial<AgentElement> = {}): AgentElement => ({
  ref: "e1",
  frameId: 0,
  tag: "div",
  name: "Option",
  visible: true,
  enabled: true,
  editable: false,
  sensitive: false,
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

const command = (partial: Partial<AgentCommand> & { type: string }) =>
  ({
    snapshotId: "snapshot-1",
    generation: 1,
    ref: "e1",
    ...partial
  }) as AgentCommand

describe("Agent pointer affordances", () => {
  it("lets a click reach the widget roles a custom dropdown is built from", () => {
    for (const role of ["combobox", "option", "tab", "treeitem", "switch"]) {
      expect(
        classifyAgentAffordance(
          command({ type: "click" }),
          observation([element({ role })])
        ),
        role
      ).toBeUndefined()
    }
    expect(
      classifyAgentAffordance(
        command({ type: "click" }),
        observation([element({ role: "presentation" })])
      )?.reason
    ).toBe("not_clickable")
  })

  it("sends a double click on a link or submitter back to click", () => {
    const link = classifyAgentAffordance(
      command({ type: "double_click" }),
      observation([element({ tag: "a", href: "https://example.com/next" })])
    )
    expect(link?.reason).toBe("use_click_instead")
    expect(agentAffordanceFeedback(link as never)).toContain("a link")
    expect(
      classifyAgentAffordance(
        command({ type: "double_click" }),
        observation([element({ tag: "button", submitter: true })])
      )?.reason
    ).toBe("use_click_instead")
    expect(
      classifyAgentAffordance(
        command({ type: "double_click" }),
        observation([element({ tag: "input", type: "checkbox" })])
      )?.reason
    ).toBe("use_check_instead")
    expect(
      classifyAgentAffordance(
        command({ type: "double_click" }),
        observation([element({ role: "listitem" })])
      )
    ).toBeUndefined()
  })

  it("lets a hover rest on a disabled control but not a hidden one", () => {
    expect(
      classifyAgentAffordance(
        command({ type: "hover" }),
        observation([element({ tag: "button", enabled: false })])
      )
    ).toBeUndefined()
    expect(
      classifyAgentAffordance(
        command({ type: "hover" }),
        observation([element({ visible: false })])
      )?.reason
    ).toBe("hidden_target")
  })

  it("treats a hover as low risk and a chord as an activation", () => {
    const base = {
      runId: "run",
      stepId: "run:1",
      allowedOrigins: ["https://example.com"],
      scopedTabIds: [7],
      now: 1
    }
    const hover = evaluateAgentPolicy({
      ...base,
      effect: {
        command: command({ type: "hover" }),
        target: { sensitive: false, maySubmit: false },
        semanticEffects: ["hover"],
        snapshotIdentity: {
          snapshotId: "snapshot-1",
          generation: 1,
          tabId: 7,
          frameId: 0,
          documentId: "document-1"
        },
        sourceUrl: "https://example.com/",
        sourceOrigin: "https://example.com"
      }
    })
    expect(hover).toEqual({ type: "allow", risk: "low" })
    const chord = evaluateAgentPolicy({
      ...base,
      effect: {
        command: command({ type: "press_key", key: "Control+a" } as never),
        target: { sensitive: false, maySubmit: false },
        semanticEffects: ["activation"],
        snapshotIdentity: {
          snapshotId: "snapshot-1",
          generation: 1,
          tabId: 7,
          frameId: 0,
          documentId: "document-1"
        },
        sourceUrl: "https://example.com/",
        sourceOrigin: "https://example.com"
      }
    })
    expect(chord.type).toBe("approval_required")
  })
})
