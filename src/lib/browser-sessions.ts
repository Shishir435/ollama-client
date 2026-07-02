import {
  resolveExcludedUrlPatterns,
  urlMatchesAny
} from "@/contents/url-filter"
import {
  browser,
  supportsSessions,
  supportsSyncedSessions
} from "@/lib/browser-api"
import { isContentScriptReadableUrl } from "@/lib/browser-tab-access"
import { isNeverReadUrl } from "@/lib/per-site-profiles"
import { hasPermission } from "@/lib/permissions"

interface SessionTab {
  sessionId?: string
  title?: string
  url?: string
}

interface SessionWindow {
  sessionId?: string
  tabs?: SessionTab[]
}

interface BrowserSession {
  lastModified?: number
  tab?: SessionTab
  window?: SessionWindow
}

interface SessionDevice {
  deviceName?: string
  sessions?: BrowserSession[]
}

interface SessionsApi {
  getRecentlyClosed(filter?: { maxResults?: number }): Promise<BrowserSession[]>
  getDevices?(filter?: { maxResults?: number }): Promise<SessionDevice[]>
  restore?(sessionId?: string): Promise<BrowserSession>
}

export interface ReadableBrowserSession {
  sessionId?: string
  kind: "tab" | "window"
  title: string
  url?: string
  tabs: Array<{ title: string; url: string }>
  lastModified?: number
}

export interface BrowserSessionList {
  sessions: ReadableBrowserSession[]
  skipped: number
}

const getSessionsApi = (): SessionsApi | undefined =>
  (browser as unknown as { sessions?: SessionsApi }).sessions

const normalizeTimestamp = (value: number | undefined): number | undefined => {
  if (!value || !Number.isFinite(value)) return undefined
  return value < 1_000_000_000_000 ? value * 1000 : value
}

const readableTab = async (
  tab: SessionTab,
  excludedPatterns: string[]
): Promise<{ title: string; url: string } | undefined> => {
  const url = tab.url
  if (
    !url ||
    !isContentScriptReadableUrl(url) ||
    urlMatchesAny(url, excludedPatterns) ||
    (await isNeverReadUrl(url))
  ) {
    return undefined
  }
  return { title: tab.title?.trim() || url, url }
}

const toReadableSession = async (
  session: BrowserSession,
  excludedPatterns: string[]
): Promise<ReadableBrowserSession | undefined> => {
  if (session.tab) {
    const tab = await readableTab(session.tab, excludedPatterns)
    if (!tab) return undefined
    return {
      sessionId: session.tab.sessionId,
      kind: "tab",
      title: tab.title,
      url: tab.url,
      tabs: [tab],
      lastModified: normalizeTimestamp(session.lastModified)
    }
  }

  if (session.window) {
    const tabs = (
      await Promise.all(
        (session.window.tabs ?? []).map((tab) =>
          readableTab(tab, excludedPatterns)
        )
      )
    ).filter((tab): tab is { title: string; url: string } => Boolean(tab))
    if (tabs.length === 0) return undefined
    return {
      sessionId: session.window.sessionId,
      kind: "window",
      title: `${tabs.length} recently closed tabs`,
      tabs,
      lastModified: normalizeTimestamp(session.lastModified)
    }
  }

  return undefined
}

const filterSessions = async (
  sessions: BrowserSession[]
): Promise<BrowserSessionList> => {
  const excludedPatterns = await resolveExcludedUrlPatterns()
  const readable = await Promise.all(
    sessions.map((session) => toReadableSession(session, excludedPatterns))
  )
  return {
    sessions: readable.filter((session): session is ReadableBrowserSession =>
      Boolean(session)
    ),
    skipped: readable.filter((session) => !session).length
  }
}

export const getBrowserSessionsAvailability = async (): Promise<
  "available" | "unsupported" | "permission"
> => {
  if (!supportsSessions()) return "unsupported"
  if (!(await hasPermission("sessions"))) return "permission"
  return "available"
}

const requireBrowserSessionsAccess = async (): Promise<void> => {
  const availability = await getBrowserSessionsAvailability()
  if (availability === "available") return
  if (availability === "unsupported") {
    throw new Error("Browser sessions are not supported in this browser.")
  }
  throw new Error(
    "Browser sessions permission is not granted or was disabled. Enable it in Settings > Permissions."
  )
}

export const listRecentlyClosedBrowserSessions = async (
  limit = 10
): Promise<BrowserSessionList> => {
  await requireBrowserSessionsAccess()
  const api = getSessionsApi()
  if (!api?.getRecentlyClosed) return { sessions: [], skipped: 0 }
  return filterSessions(await api.getRecentlyClosed({ maxResults: limit }))
}

/**
 * Reopen a recently closed tab/window. With no id, restores the most recently
 * closed session; with an id, the specific one. `chrome.sessions.restore` only
 * acts on sessions the user themselves closed and reopens them in the user's own
 * browser — it never exposes page content to the model — so it ships without a
 * per-call confirmation gate (unlike other write/action tools).
 */
export const restoreBrowserSession = async (
  sessionId?: string
): Promise<void> => {
  await requireBrowserSessionsAccess()
  const api = getSessionsApi()
  if (!api?.restore) {
    throw new Error("Restoring sessions is not supported in this browser.")
  }
  await api.restore(sessionId)
}

export const listSyncedBrowserSessions = async (
  limit = 10
): Promise<Array<{ deviceName: string; result: BrowserSessionList }>> => {
  await requireBrowserSessionsAccess()
  const api = getSessionsApi()
  if (!supportsSyncedSessions() || !api?.getDevices) return []
  const devices = await api.getDevices({ maxResults: limit })
  return Promise.all(
    devices.map(async (device) => ({
      deviceName: device.deviceName?.trim() || "Unknown device",
      result: await filterSessions(device.sessions ?? [])
    }))
  )
}
