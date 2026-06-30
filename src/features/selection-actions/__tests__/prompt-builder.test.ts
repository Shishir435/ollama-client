import { describe, expect, it } from "vitest"
import {
  DEFAULT_SELECTION_ACTION_IDS,
  getSelectionAction,
  SELECTION_ACTIONS
} from "../actions"
import { buildSelectionActionPrompt } from "../prompt-builder"
import type { SelectionPayload } from "../types"

const selection: SelectionPayload = {
  selectedText: "Ollama Client keeps text local.",
  pageUrl: "https://example.com/page",
  pageTitle: "Example",
  selectionType: "plain-text",
  canReplace: false,
  canInsert: false
}

describe("selection action prompt builder", () => {
  it("registers expected v1 actions", () => {
    expect(SELECTION_ACTIONS.map((action) => action.id)).toEqual([
      "summarize",
      "rewrite",
      "shorten",
      "fix-grammar",
      "explain",
      "action-items",
      "translate-english",
      "custom"
    ])
  })

  it("builds local plain-text prompts around selected text", () => {
    const prompt = buildSelectionActionPrompt({
      actionId: "summarize",
      selection
    })

    expect(prompt.messages).toHaveLength(2)
    expect(prompt.messages[0].content).toContain("private local AI assistant")
    expect(prompt.messages[1].content).toContain("Action: Summarize")
    expect(prompt.messages[1].content).toContain(selection.selectedText)
    expect(prompt.messages[1].content).toContain("Return plain text only")
    expect(prompt.messages[1].content).toContain("Do not invent facts")
  })

  it("uses custom instruction only for custom action", () => {
    const prompt = buildSelectionActionPrompt({
      actionId: "custom",
      selection,
      customInstruction: "Make this more polite."
    })

    expect(prompt.messages[1].content).toContain("Make this more polite.")
  })

  it("preserves configured language instructions", () => {
    const prompt = buildSelectionActionPrompt(
      {
        actionId: "custom",
        selection: {
          ...selection,
          selectedText: "Das ist ein deutscher Text."
        },
        customInstruction: "Fasse den Text kurz zusammen."
      },
      "Antworte immer auf Deutsch."
    )

    expect(prompt.messages[0].content).toContain("Antworte immer auf Deutsch.")
    expect(prompt.messages[1].content).toContain(
      "Follow any output language requested"
    )
    expect(prompt.messages[1].content).toContain(
      "Fasse den Text kurz zusammen."
    )
  })

  it("keeps translate-to-English explicit", () => {
    const prompt = buildSelectionActionPrompt({
      actionId: "translate-english",
      selection: { ...selection, selectedText: "Guten Morgen." }
    })

    expect(prompt.messages[1].content).toContain("Output in English.")
  })

  it("ignores customInstruction for non-custom actions", () => {
    const prompt = buildSelectionActionPrompt({
      actionId: "shorten",
      selection,
      customInstruction: "This should be ignored."
    })

    expect(prompt.messages[1].content).not.toContain("This should be ignored.")
    expect(prompt.messages[1].content).toContain("Action: Shorten")
  })

  it("uses 'Untitled' when pageTitle is empty", () => {
    const prompt = buildSelectionActionPrompt({
      actionId: "explain",
      selection: { ...selection, pageTitle: "" }
    })
    expect(prompt.messages[1].content).toContain("Page title: Untitled")
  })
})

describe("getSelectionAction", () => {
  it("returns correct definition for every registered action", () => {
    for (const id of DEFAULT_SELECTION_ACTION_IDS) {
      const action = getSelectionAction(id)
      expect(action.id).toBe(id)
      expect(action.label).toBeTruthy()
      expect(action.shortLabel).toBeTruthy()
      expect(action.instruction).toBeTruthy()
    }
  })

  it("falls back to first action (summarize) for unknown id", () => {
    const action = getSelectionAction("nonexistent" as never)
    expect(action.id).toBe("summarize")
  })
})
