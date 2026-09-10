import type {
  AgentCommand,
  AgentDialogState,
  AgentElement,
  AgentObservation
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import { classifyAgentAffordance } from "../affordance"

const button: AgentElement = {
  ref: "e1",
  frameId: 0,
  tag: "button",
  name: "Continue",
  visible: true,
  enabled: true,
  editable: false,
  sensitive: false
}

const observation = (dialogs: AgentDialogState[]): AgentObservation => ({
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
  elements: [button],
  visibleText: "Continue",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  },
  dialogs,
  capturedAt: 1
})

const confirm: AgentDialogState = {
  id: "d1",
  type: "confirm",
  origin: "https://example.com",
  message: "Delete?"
}

const grounded = { snapshotId: "snapshot-1", generation: 1 } as const

const commands: AgentCommand[] = [
  { ...grounded, type: "read" },
  { ...grounded, type: "extract_text" },
  { ...grounded, type: "click", ref: "e1" },
  { ...grounded, type: "scroll", direction: "down" },
  { ...grounded, type: "navigate", url: "https://example.com/next" },
  { ...grounded, type: "switch_tab", tabId: 9 }
]

describe("a dialog holding the page", () => {
  it.each(
    commands.map((command) => [command.type, command] as const)
  )("refuses %s while one is unanswered", (_type, command) => {
    // The document's script is blocked, so there is no page to read or act
    // on. Any answer other than "answer the dialog" would be aimed at a
    // page that cannot respond.
    expect(classifyAgentAffordance(command, observation([confirm]))).toEqual({
      reason: "dialog_open"
    })
  })

  it("accepts an answer naming the dialog that is open", () => {
    expect(
      classifyAgentAffordance(
        { ...grounded, type: "handle_dialog", dialogId: "d1", accept: false },
        observation([confirm])
      )
    ).toBeUndefined()
  })

  it("refuses an answer naming a prompt that has been replaced", () => {
    expect(
      classifyAgentAffordance(
        { ...grounded, type: "handle_dialog", dialogId: "d0", accept: true },
        observation([confirm])
      )
    ).toEqual({ reason: "unknown_dialog" })
  })

  it("refuses prompt text on a dialog with no field", () => {
    expect(
      classifyAgentAffordance(
        {
          ...grounded,
          type: "handle_dialog",
          dialogId: "d1",
          accept: true,
          promptText: "x"
        },
        observation([confirm])
      )
    ).toEqual({ reason: "prompt_text_unsupported" })
  })

  it("takes prompt text where the dialog has a field", () => {
    expect(
      classifyAgentAffordance(
        {
          ...grounded,
          type: "handle_dialog",
          dialogId: "d1",
          accept: true,
          promptText: "Roadmap"
        },
        observation([
          {
            id: "d1",
            type: "prompt",
            origin: "https://example.com",
            message: "Name"
          }
        ])
      )
    ).toBeUndefined()
  })
})

describe("a page with no dialog", () => {
  it("refuses an answer when nothing is open", () => {
    expect(
      classifyAgentAffordance(
        { ...grounded, type: "handle_dialog", dialogId: "d1", accept: false },
        observation([])
      )
    ).toEqual({ reason: "unknown_dialog" })
  })

  it("leaves ordinary commands alone", () => {
    expect(
      classifyAgentAffordance(
        { ...grounded, type: "click", ref: "e1" },
        observation([])
      )
    ).toBeUndefined()
  })
})
