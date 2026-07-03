import {
  getBrowserSessionsAvailability,
  listRecentlyClosedBrowserSessions,
  listSyncedBrowserSessions,
  type ReadableBrowserSession,
  restoreBrowserSession
} from "@/lib/browser-sessions"
import {
  DEFAULT_MAX_RESTORE_SESSIONS,
  MAX_MAX_RESTORE_SESSIONS,
  MIN_MAX_RESTORE_SESSIONS
} from "@/lib/constants/config"
import { STORAGE_KEYS } from "@/lib/constants/keys"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"

/** Read the user-configured cap on how many tabs restore_session reopens. */
const getMaxRestoreSessions = async (): Promise<number> => {
  const stored = await plasmoGlobalStorage.get<number>(
    STORAGE_KEYS.BROWSER.MAX_RESTORE_SESSIONS
  )
  if (typeof stored !== "number" || !Number.isFinite(stored)) {
    return DEFAULT_MAX_RESTORE_SESSIONS
  }
  return Math.max(
    MIN_MAX_RESTORE_SESSIONS,
    Math.min(MAX_MAX_RESTORE_SESSIONS, Math.floor(stored))
  )
}

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
    'Reopen one or more recently closed browser tabs/windows the user closed. To reopen several at once (e.g. "open them all"), pass every [id: ...] from list_recently_closed in `sessionIds` in a single call — restoring one session does not affect the IDs of the others (each id is single-use: once restored, it leaves the closed list). Pass a single id in `sessionId`, or omit both to reopen just the most recently closed. Requires optional browser sessions permission.',
  displayNameKey: "chat.reasoning.trace.restoreSession",
  category: "browser",
  iconKey: "history",
  // Medium: it never returns page content to the model, but it does act on the
  // browser (opens tabs/windows) — that leaves a visible trace, so the approval
  // policy confirms it once per chat.
  risk: "medium",
  cacheable: false,
  requires: ["tabs"],
  runtime: { timeoutMs: 15_000, maxResultChars: 2000 },
  parameters: {
    type: "object",
    properties: {
      sessionIds: {
        type: "array",
        items: { type: "string" },
        description:
          "The [id: ...] values to reopen, in order. Use this to reopen multiple sessions in one call."
      },
      sessionId: {
        type: "string",
        description:
          "A single [id: ...] to reopen. Omit both fields to reopen the most recently closed session."
      }
    }
  }
}

const collectSessionIds = (args: Record<string, unknown>): string[] => {
  const ids: string[] = []
  if (Array.isArray(args.sessionIds)) {
    for (const value of args.sessionIds) {
      if (typeof value === "string" && value.trim()) ids.push(value.trim())
    }
  }
  if (typeof args.sessionId === "string" && args.sessionId.trim()) {
    ids.push(args.sessionId.trim())
  }
  // De-dupe so a doubled id doesn't try to restore an already-consumed session.
  return [...new Set(ids)]
}

export const runRestoreSession = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const unavailable = await availabilityError()
  if (unavailable) return unavailable

  const requestedIds = collectSessionIds(args)
  // Bound how many tabs one model action can spawn (user-configurable).
  const cap = await getMaxRestoreSessions()
  const ids = requestedIds.slice(0, cap)
  const overCap = requestedIds.length - ids.length

  // No ids → reopen just the most recently closed session.
  if (ids.length === 0) {
    try {
      await restoreBrowserSession(undefined)
      return { content: "Reopened the most recently closed session." }
    } catch (error) {
      return {
        content:
          error instanceof Error ? error.message : "Failed to restore session.",
        isError: true
      }
    }
  }

  // Restore each requested session in order, collecting per-id outcomes so a
  // single failure doesn't hide the ones that succeeded.
  const restored: string[] = []
  const failed: string[] = []
  for (const id of ids) {
    try {
      await restoreBrowserSession(id)
      restored.push(id)
    } catch {
      failed.push(id)
    }
  }

  const parts: string[] = []
  if (restored.length > 0) {
    parts.push(
      `Reopened ${restored.length} session(s): ${restored.join(", ")}.`
    )
  }
  if (failed.length > 0) {
    parts.push(
      `Could not reopen ${failed.length}: ${failed.join(", ")} (no longer available).`
    )
  }
  if (overCap > 0) {
    parts.push(
      `${overCap} more not reopened — the per-call limit is ${cap} (change it in Settings > Privacy & permissions).`
    )
  }
  return { content: parts.join(" "), isError: restored.length === 0 }
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
