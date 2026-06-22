import type { ToolDefinition } from "@/lib/tools"

const TAB_TOOL_NAMES = new Set([
  "current_tab",
  "read_tab",
  "list_tabs",
  "list_tab_groups",
  "read_tab_group"
])
const TAB_GROUP_TOOL_NAMES = new Set(["list_tab_groups", "read_tab_group"])
const BROWSER_KNOWLEDGE_TOOL_NAMES = new Set([
  "get_recent_history",
  "search_bookmarks"
])
const WEB_SEARCH_TOOL_NAME = "web_search"
const SCHEDULE_REMINDER_TOOL_NAME = "schedule_reminder"

const formatDateForGuidance = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export const buildToolSystemGuidance = (
  tools: ToolDefinition[] | undefined,
  now = new Date()
): string => {
  if (!tools || tools.length === 0) return ""

  const toolNames = tools.map((tool) => tool.name).join(", ")
  const hasTabTools = tools.some((tool) => TAB_TOOL_NAMES.has(tool.name))
  const hasTabGroupTools = tools.some((tool) =>
    TAB_GROUP_TOOL_NAMES.has(tool.name)
  )
  const hasBrowserKnowledgeTools = tools.some((tool) =>
    BROWSER_KNOWLEDGE_TOOL_NAMES.has(tool.name)
  )
  const hasWebSearch = tools.some((tool) => tool.name === WEB_SEARCH_TOOL_NAME)
  const hasScheduleReminder = tools.some(
    (tool) => tool.name === SCHEDULE_REMINDER_TOOL_NAME
  )
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

  if (hasTabGroupTools) {
    guidance.push(
      "When the user refers to a browser tab group, grouped tabs, or asks to summarize/compare a group, call list_tab_groups first unless the group id is already known, then read_tab_group for the target group."
    )
  }

  if (hasWebSearch) {
    const currentDate = formatDateForGuidance(now)
    const currentYear = now.getFullYear()
    const oldYears = `${currentYear - 2} or ${currentYear - 1}`
    guidance.push(
      `Current date is ${currentDate}. Use web_search for current or real-time facts; prefer it over guessing when a question is time-sensitive; cite returned URLs.`,
      `For current/latest web searches, query the current year (${currentYear}) or the exact current date when useful. Do not add old years such as ${oldYears} unless the user asks for those years.`,
      "When the question is about recent or ongoing events (e.g. 'latest', 'recent', 'today', news, trips, prices), also set web_search time_range to 'day' or 'week' (use 'month' for less urgent recency) so stale results are filtered out."
    )
  }

  if (hasBrowserKnowledgeTools) {
    guidance.push(
      "When the user asks about recently visited websites/pages, call get_recent_history with the requested limit before answering. When the user asks about saved pages/bookmarks, call search_bookmarks before answering. If a browser-knowledge tool says permission is off or no data is available, tell the user to enable the matching permission in Settings > Permissions."
    )
  }

  if (hasScheduleReminder) {
    guidance.push(
      "Use schedule_reminder only when the user explicitly asks to be reminded or notified later. For requests like 'remind me in 2 minutes to stretch', call schedule_reminder with delay_minutes=2 and message='Stretch', then confirm it was scheduled."
    )
  }

  return `\n\n${guidance.join(" ")}`
}
