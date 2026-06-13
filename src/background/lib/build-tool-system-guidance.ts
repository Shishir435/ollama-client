import type { ToolDefinition } from "@/lib/tools"

const TAB_TOOL_NAMES = new Set(["current_tab", "read_tab", "list_tabs"])

export const buildToolSystemGuidance = (
  tools: ToolDefinition[] | undefined
): string => {
  if (!tools || tools.length === 0) return ""

  const toolNames = tools.map((tool) => tool.name).join(", ")
  const hasTabTools = tools.some((tool) => TAB_TOOL_NAMES.has(tool.name))
  const guidance = [
    `You have tools available: ${toolNames}.`,
    "When the user refers to current page, current tab, open tabs, selected text, uploaded files, or earlier conversations, call the matching tool to fetch real content before answering.",
    "Use tool output as source of truth; do not guess when a tool can answer."
  ]

  if (hasTabTools) {
    guidance.push(
      "For tab content, set force=true when the user asks to refresh, refetch, rescrape, reload, or get latest tab content.",
      "If a tab tool says a page is blocked or unreadable, do not retry the same tab or another Chrome Web Store/internal page; answer from visible tab metadata/tool output, or ask the user to switch/share details."
    )
  }

  return `\n\n${guidance.join(" ")}`
}
