import { getSelectionAction } from "@/features/selection-actions/actions"
import type {
  SelectionActionPrompt,
  SelectionActionRequest
} from "@/features/selection-actions/types"

const SYSTEM_PROMPT =
  "You are a private local AI assistant running inside the user's browser. Follow the requested text operation and any configured language or tone instructions. Return only the final transformed text unless the user explicitly asks for explanation. Never claim facts that are not present in the selected text."

export const buildSelectionActionPrompt = (
  request: SelectionActionRequest,
  modelSystemPrompt?: string
): SelectionActionPrompt => {
  const action = getSelectionAction(request.actionId)
  const customInstruction =
    request.actionId === "custom" ? request.customInstruction?.trim() : ""
  const instruction = customInstruction || action.instruction
  const configuredSystemPrompt = modelSystemPrompt?.trim()
  const languageRequirement =
    request.actionId === "translate-english"
      ? "Output in English. This overrides any other language requested by the configured system prompt or custom instruction."
      : "Follow any output language requested by the configured system prompt or custom instruction. Otherwise, use the same language as the selected text."

  return {
    messages: [
      {
        role: "system",
        content: [configuredSystemPrompt, SYSTEM_PROMPT]
          .filter(Boolean)
          .join("\n\n")
      },
      {
        role: "user",
        content: [
          `Action: ${action.label}`,
          `Instruction: ${instruction}`,
          `Page title: ${request.selection.pageTitle || "Untitled"}`,
          `Page URL: ${request.selection.pageUrl}`,
          "",
          "Selected text:",
          request.selection.selectedText,
          "",
          "Requirements:",
          "- Keep the result focused on the selected text.",
          "- Return plain text only.",
          "- Do not mention that you are an AI.",
          "- Do not invent facts not present in the selected text.",
          `- ${languageRequirement}`
        ].join("\n")
      }
    ]
  }
}
