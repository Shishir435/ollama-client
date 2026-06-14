import type { ToolCategory, ToolRiskLevel } from "./types"

export interface ToolDisplayMeta {
  displayNameKey?: string
  iconKey?: string
  category?: ToolCategory
  risk?: ToolRiskLevel
}

const LEGACY_TOOL_DISPLAY_META: Record<string, ToolDisplayMeta> = {
  web_search: {
    displayNameKey: "chat.reasoning.trace.web",
    iconKey: "search",
    category: "web"
  },
  rag_search: {
    displayNameKey: "chat.reasoning.trace.knowledge",
    iconKey: "search",
    category: "knowledge"
  },
  file_search: {
    displayNameKey: "chat.reasoning.trace.documents",
    iconKey: "file-stack",
    category: "files"
  },
  current_tab: {
    displayNameKey: "chat.reasoning.trace.tab",
    iconKey: "panels-top-left",
    category: "browser"
  },
  list_tabs: {
    displayNameKey: "chat.reasoning.trace.tabs",
    iconKey: "list",
    category: "browser"
  },
  read_tab: {
    displayNameKey: "chat.reasoning.trace.tab",
    iconKey: "file-text",
    category: "browser"
  },
  selected_text: {
    displayNameKey: "chat.reasoning.trace.selection",
    iconKey: "text-select",
    category: "selection"
  }
}

export const getToolDisplayMeta = (toolId: string): ToolDisplayMeta =>
  LEGACY_TOOL_DISPLAY_META[toolId] ?? {}
