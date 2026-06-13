import type { ToolContext, ToolDefinition, ToolResult } from "../types"
import { listReadableTabs } from "./tab-utils"

/**
 * `list_tabs` — enumerate the user's open tabs so the model can pick one to read
 * with `read_tab`, without the user manually adding it through the tab-context
 * UI. Only http/file tabs are listed (extension and browser-internal pages are
 * unreadable anyway).
 */
export const listTabsDefinition: ToolDefinition = {
  name: "list_tabs",
  description:
    "List the user's currently open browser tabs (id, title, URL). Use this to find which tab the user means before calling read_tab to read a specific one.",
  parameters: { type: "object", properties: {} }
}

export const runListTabs = async (
  _args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const tabs = await listReadableTabs()
  if (tabs.length === 0) {
    return { content: "No readable tabs are open." }
  }
  const lines = tabs.map(
    (tab) =>
      `- id=${tab.id}${tab.active ? " (active)" : ""}: ${tab.title} — ${tab.url}`
  )
  return {
    content: `Open tabs:\n${lines.join("\n")}`,
    sources: tabs.map((tab) => ({ title: tab.title, url: tab.url }))
  }
}
