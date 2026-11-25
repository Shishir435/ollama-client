/**
 * Built-in tools known to change nothing outside the conversation: they read
 * tabs, history, bookmarks, documents or the web and leave no trace a second
 * call would duplicate.
 *
 * This is an allowlist on purpose. Approval risk does not answer the question —
 * `save_artifact`, `schedule_reminder` and `restore_session` are rated medium
 * yet write a file, schedule a reminder or open windows — and a tool missing
 * from here (a new built-in, any MCP tool) is treated as having an effect.
 */
export const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "rag_search",
  "file_search",
  "list_reminders",
  "list_tab_groups",
  "read_tab_group",
  "current_tab",
  "list_tabs",
  "read_tab",
  "get_recent_history",
  "search_bookmarks",
  "capture_screenshot",
  "list_recently_closed",
  "list_synced_sessions",
  "web_search"
])
