import {
  getRecentHistoryItems,
  searchBookmarkItems
} from "@/lib/browser-knowledge"
import { hasPermission } from "@/lib/permissions"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"

const clampLimit = (value: unknown, fallback = 10): number => {
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, Math.min(50, Math.floor(numberValue)))
}

const formatHistoryTime = (time: number | undefined): string =>
  time ? new Date(time).toLocaleString() : "unknown time"

export const recentHistoryDefinition: ToolDefinition = {
  name: "get_recent_history",
  description:
    "Get the user's most recent browser history items. Use when the user asks what sites/pages they recently visited, such as 'last 10 websites I visited'. Requires the optional history permission.",
  displayNameKey: "chat.reasoning.trace.history",
  category: "browser",
  iconKey: "history",
  risk: "medium",
  cacheable: false,
  requires: ["storage"],
  runtime: { timeoutMs: 10_000, maxResultChars: 8000 },
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description:
          "Maximum number of recent history items to return. Default 10, max 50."
      }
    }
  }
}

export const searchBookmarksDefinition: ToolDefinition = {
  name: "search_bookmarks",
  description:
    "Search the user's browser bookmarks by title or URL. Use when the user asks about saved pages/bookmarks. Requires the optional bookmarks permission.",
  displayNameKey: "chat.reasoning.trace.bookmarks",
  category: "browser",
  iconKey: "bookmark",
  risk: "medium",
  cacheable: false,
  requires: ["storage"],
  runtime: { timeoutMs: 10_000, maxResultChars: 8000 },
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Bookmark search text. Use an empty string only if the user asks to list bookmarks generally."
      },
      limit: {
        type: "number",
        description:
          "Maximum number of bookmarks to return. Default 10, max 50."
      }
    },
    required: ["query"]
  }
}

export const runRecentHistory = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const limit = clampLimit(args.limit)
  if (!(await hasPermission("history"))) {
    return {
      content:
        "Browsing history permission is not granted. Enable History in Settings > Permissions.",
      isError: true
    }
  }

  const items = await getRecentHistoryItems(limit)

  if (items.length === 0) {
    return {
      content: "No readable browser history was found."
    }
  }

  const lines = items.map((item, index) => {
    const title = item.title?.trim() || item.url || "Untitled"
    const url = item.url ?? "unknown URL"
    return `${index + 1}. ${title} — ${url} (last visited ${formatHistoryTime(
      item.lastVisitTime
    )}, visits ${item.visitCount ?? 0})`
  })

  return {
    content: `Recent browser history:\n${lines.join("\n")}`,
    sources: items.map((item) => ({
      title: item.title?.trim() || item.url || "Untitled",
      url: item.url
    }))
  }
}

export const runSearchBookmarks = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const query = typeof args.query === "string" ? args.query.trim() : ""
  const limit = clampLimit(args.limit)
  if (!(await hasPermission("bookmarks"))) {
    return {
      content:
        "Bookmarks permission is not granted. Enable Bookmarks in Settings > Permissions.",
      isError: true
    }
  }

  const items = await searchBookmarkItems(query, limit)

  if (items.length === 0) {
    return { content: "No matching readable bookmarks were found." }
  }

  const lines = items.map((item, index) => {
    const title = item.title?.trim() || item.url || "Untitled"
    return `${index + 1}. ${title} — ${item.url}`
  })

  return {
    content: `Matching bookmarks:\n${lines.join("\n")}`,
    sources: items.map((item) => ({
      title: item.title?.trim() || item.url || "Untitled",
      url: item.url
    }))
  }
}
