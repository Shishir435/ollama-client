import { STORAGE_KEYS } from "@/lib/constants"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"

/**
 * `selected_text` — return the text the user most recently selected on a page.
 * Reads the device-local handoff written by the context-menu / selection
 * actions (`PENDING_SELECTION_TEXT`); nothing is fetched live.
 */
export const selectedTextDefinition: ToolDefinition = {
  name: "selected_text",
  description:
    "Get the text the user most recently selected or highlighted on a web page. Use when the user refers to 'the selected text', 'this selection', or 'what I highlighted'.",
  displayNameKey: "chat.reasoning.trace.selection",
  category: "selection",
  iconKey: "text-select",
  risk: "low",
  cacheable: false,
  requires: ["selection"],
  runtime: { timeoutMs: 10_000, maxResultChars: 6000 },
  parameters: { type: "object", properties: {} }
}

export const runSelectedText = async (
  _args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const text = await getPlasmoStoredValue<string>(
    STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT
  )
  if (!text?.trim()) {
    return { content: "No text is currently selected." }
  }
  return { content: text }
}
