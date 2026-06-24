import type { ToolCategory, ToolDefinition } from "./types"

/**
 * Tool families (E10 — FEATURE_ROADMAP §3). A governance grouping layered over
 * the existing per-tool `category`, used only to decide which tools a model may
 * be offered. Families map to risk classes the user controls in the Permissions
 * tab — deliberately coarser than `category`, and distinct from it: history and
 * bookmark tools are `category: "browser"` but live in their own `history`
 * family because they are gated by an extra OS permission and read sensitive
 * data.
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
  list_tabs: "browser",
  read_tab: "browser",
  list_tab_groups: "browser",
  read_tab_group: "browser",
  selected_text: "browser",
  rag_search: "knowledge",
  file_search: "knowledge",
  recent_history: "history",
  search_bookmarks: "history",
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
