import type { ToolCategory, ToolDefinition } from "./types"

/**
 * Governance grouping layered over per-tool `category`, used to decide which
 * tools a model may be offered. Families map to risk classes controlled in the
 * Permissions tab. History and bookmark tools are `category: "browser"` but
 * live in their own `history` family because they require extra browser
 * permissions and read sensitive data.
 */
export type ToolFamily =
  | "browser"
  | "knowledge"
  | "history"
  | "web"
  | "automation"

export const TOOL_FAMILIES: ToolFamily[] = [
  "browser",
  "knowledge",
  "history",
  "web",
  "automation"
]

/** Explicit family per known tool name — the source of truth for built-ins. */
const FAMILY_BY_TOOL_NAME: Record<string, ToolFamily> = {
  current_tab: "browser",
  capture_screenshot: "browser",
  list_tabs: "browser",
  read_tab: "browser",
  list_tab_groups: "browser",
  read_tab_group: "browser",
  selected_text: "browser",
  rag_search: "knowledge",
  file_search: "knowledge",
  get_recent_history: "history",
  search_bookmarks: "history",
  list_recently_closed: "history",
  list_synced_sessions: "history",
  web_search: "web",
  schedule_reminder: "automation",
  save_artifact: "automation"
}

/**
 * Fallback family by `category`, for tools not in the explicit map (e.g. future
 * MCP tools). Keeps the gate deterministic instead of silently dropping tools.
 */
const FAMILY_BY_CATEGORY: Record<ToolCategory, ToolFamily> = {
  browser: "browser",
  selection: "browser",
  knowledge: "knowledge",
  files: "knowledge",
  web: "web",
  system: "automation",
  external: "automation"
}

/** Resolve the governance family for a tool. Never throws; defaults to automation. */
export const getToolFamily = (definition: ToolDefinition): ToolFamily => {
  const byName = FAMILY_BY_TOOL_NAME[definition.name]
  if (byName) return byName
  // `?? "automation"` guards a future source (e.g. MCP) emitting a category
  // outside the ToolCategory union, which would otherwise return undefined and
  // slip past the family filter ungoverned.
  if (definition.category) {
    return FAMILY_BY_CATEGORY[definition.category] ?? "automation"
  }
  return "automation"
}
