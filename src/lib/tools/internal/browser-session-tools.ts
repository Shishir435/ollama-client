import {
  getBrowserSessionsAvailability,
  listRecentlyClosedBrowserSessions,
  listSyncedBrowserSessions,
  type ReadableBrowserSession,
  restoreBrowserSession
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
      "Browser sessions permission is not granted or was disabled. Enable Recently closed tabs in Settings > Permissions.",
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
  // Surface the restore id so the model can pass it to restore_session.
  const id = session.sessionId ? ` [id: ${session.sessionId}]` : ""
  if (session.kind === "tab") {
    return `${index + 1}. ${session.title} — ${session.url} (closed ${when})${id}`
  }
  const tabs = session.tabs.map((tab) => `${tab.title} — ${tab.url}`).join("; ")
  return `${index + 1}. Window: ${tabs} (closed ${when})${id}`
}

const toSources = (sessions: ReadableBrowserSession[]) =>
  sessions.flatMap((session) =>
    session.tabs.map((tab) => ({ title: tab.title, url: tab.url }))
  )

export const listRecentlyClosedDefinition: ToolDefinition = {
  name: "list_recently_closed",
  description:
    "List recently closed readable browser tabs and windows. Use when the user asks what they closed or wants to find a recently closed page. Each entry includes an [id: ...]; pass that id to restore_session to reopen it. Requires optional browser sessions permission.",
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

export const restoreSessionDefinition: ToolDefinition = {
  name: "restore_session",
  description:
    "Reopen a recently closed browser tab or window that the user closed. Pass the [id: ...] from list_recently_closed; omit it to reopen the most recently closed session. Requires optional browser sessions permission.",
  displayNameKey: "chat.reasoning.trace.restoreSession",
  category: "browser",
  iconKey: "history",
  // Low risk: it only reopens the user's own closed tab in their browser and
  // never returns page content to the model.
  risk: "low",
  cacheable: false,
  requires: ["tabs"],
  runtime: { timeoutMs: 10_000, maxResultChars: 2000 },
  parameters: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description:
          "The [id: ...] of the session to reopen. Omit to reopen the most recently closed session."
      }
    }
  }
}

export const runRestoreSession = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const unavailable = await availabilityError()
  if (unavailable) return unavailable

  const sessionId =
    typeof args.sessionId === "string" && args.sessionId.trim()
      ? args.sessionId.trim()
      : undefined

  try {
    await restoreBrowserSession(sessionId)
    return {
      content: sessionId
        ? `Reopened the closed session (id: ${sessionId}).`
        : "Reopened the most recently closed session."
    }
  } catch (error) {
    return {
      content:
        error instanceof Error ? error.message : "Failed to restore session.",
      isError: true
    }
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
