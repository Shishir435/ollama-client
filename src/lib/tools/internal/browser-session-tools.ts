import {
  getBrowserSessionsAvailability,
  listRecentlyClosedBrowserSessions,
  listSyncedBrowserSessions,
  type ReadableBrowserSession
} from "@/lib/browser-sessions"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"

const clampLimit = (value: unknown, fallback = 10): number => {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(25, Math.floor(parsed)))
}

const availabilityError = async (): Promise<ToolResult | undefined> => {
  const availability = await getBrowserSessionsAvailability()
  if (availability === "available") return undefined
  if (availability === "unsupported") {
    return {
      content: "Recently closed sessions are not supported in this browser.",
      isError: true
    }
  }
  return {
    content:
      "Browser sessions permission is not granted. Enable Recently closed tabs in Settings > Permissions.",
    isError: true
  }
}

const formatSession = (
  session: ReadableBrowserSession,
  index: number
): string => {
  const when = session.lastModified
    ? new Date(session.lastModified).toLocaleString()
    : "unknown time"
  if (session.kind === "tab") {
    return `${index + 1}. ${session.title} — ${session.url} (closed ${when})`
  }
  const tabs = session.tabs.map((tab) => `${tab.title} — ${tab.url}`).join("; ")
  return `${index + 1}. Window: ${tabs} (closed ${when})`
}

const toSources = (sessions: ReadableBrowserSession[]) =>
  sessions.flatMap((session) =>
    session.tabs.map((tab) => ({ title: tab.title, url: tab.url }))
  )

export const listRecentlyClosedDefinition: ToolDefinition = {
  name: "list_recently_closed",
  description:
    "List recently closed readable browser tabs and windows. Use when the user asks what they closed or wants to find a recently closed page. Requires optional browser sessions permission. This tool only reads; it cannot restore sessions.",
  displayNameKey: "chat.reasoning.trace.sessions",
  category: "browser",
  iconKey: "history",
  risk: "medium",
  cacheable: false,
  requires: ["tabs"],
  runtime: { timeoutMs: 10_000, maxResultChars: 8000 },
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Maximum sessions to return. Default 10, max 25."
      }
    }
  }
}

export const listSyncedSessionsDefinition: ToolDefinition = {
  name: "list_synced_sessions",
  description:
    "List readable browser sessions from the user's synced devices. Use only when the user asks about tabs open on another device. Requires optional browser sessions permission. This tool only reads.",
  displayNameKey: "chat.reasoning.trace.syncedSessions",
  category: "browser",
  iconKey: "history",
  risk: "medium",
  cacheable: false,
  requires: ["tabs"],
  runtime: { timeoutMs: 10_000, maxResultChars: 12_000 },
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Maximum sessions per device. Default 10, max 25."
      }
    }
  }
}

export const runListRecentlyClosed = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const unavailable = await availabilityError()
  if (unavailable) return unavailable

  const result = await listRecentlyClosedBrowserSessions(clampLimit(args.limit))
  if (result.sessions.length === 0) {
    return { content: "No readable recently closed browser sessions found." }
  }
  const skipped = result.skipped
    ? ` ${result.skipped} excluded or unreadable session(s) skipped.`
    : ""
  return {
    content: `Recently closed sessions:\n${result.sessions
      .map(formatSession)
      .join("\n")}${skipped}`,
    sources: toSources(result.sessions)
  }
}

export const runListSyncedSessions = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const unavailable = await availabilityError()
  if (unavailable) return unavailable

  const devices = await listSyncedBrowserSessions(clampLimit(args.limit))
  const readableDevices = devices.filter(
    (device) => device.result.sessions.length > 0
  )
  if (readableDevices.length === 0) {
    return { content: "No readable synced-device browser sessions found." }
  }

  return {
    content: readableDevices
      .map(
        (device) =>
          `${device.deviceName}:\n${device.result.sessions
            .map(formatSession)
            .join("\n")}`
      )
      .join("\n\n"),
    sources: readableDevices.flatMap((device) =>
      toSources(device.result.sessions)
    )
  }
}
