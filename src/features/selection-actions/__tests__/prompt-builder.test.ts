import { describe, expect, it } from "vitest"
import { SELECTION_ACTIONS } from "../actions"
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
})
