import { describe, expect, it } from "vitest"
import { buildPromptTemplateVariableContext } from "../prompt-template-context"
import {
  extractPromptTemplateVariables,
  hasPromptTemplateVariable,
  resolvePromptTemplateVariables
} from "../prompt-template-variables"

describe("prompt template variables", () => {
  it("extracts unique variable names", () => {
    expect(
      extractPromptTemplateVariables(
        "Review {{ selection }} against {{tab}} and {{selection}}"
      )
    ).toEqual(["selection", "tab"])
  })

  it("resolves built-in values", () => {
    expect(
      resolvePromptTemplateVariables(
        "Summarize {{selection}} from {{tab}} on {{date}}",
        {
          selection: "selected text",
          tab: "Title: Docs",
          now: new Date("2026-06-23T10:20:30Z")
        }
      )
    ).toContain("Summarize selected text from Title: Docs on")
  })

  it("keeps unknown variables for user-defined fields", () => {
    expect(resolvePromptTemplateVariables("Ask {{audience}}")).toBe(
      "Ask {{audience}}"
    )
  })

  it("detects a specific variable", () => {
    expect(hasPromptTemplateVariable("Use {{clipboard}}", "clipboard")).toBe(
      true
    )
  })

  it("preserves missing tab variables", () => {
    const context = buildPromptTemplateVariableContext({
      input: "hello",
      selectionStart: null,
      selectionEnd: null,
      selectedTabIds: [],
      tabContents: {}
    })

    expect(resolvePromptTemplateVariables("Summarize {{tabs}}", context)).toBe(
      "Summarize {{tabs}}"
    )
  })

  it("captures current selection from bounds", () => {
    expect(
      buildPromptTemplateVariableContext({
        input: "before selected after",
        selectionStart: 7,
        selectionEnd: 15,
        selectedTabIds: [],
        tabContents: {}
      }).selection
    ).toBe("selected")
  })
})
