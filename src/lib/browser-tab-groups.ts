import {
  resolveExcludedUrlPatterns,
  urlMatchesAny
} from "@/contents/url-filter"
import { browser, supportsTabGroups } from "@/lib/browser-api"
import { isNeverReadUrl } from "@/lib/per-site-profiles"
import { hasPermission, requestPermission } from "@/lib/permissions"
import { isContentScriptReadableUrl } from "./browser-tab-access"

export interface BrowserGroupTab {
  id: number
  title: string
  url: string
  active: boolean
}

export interface BrowserTabGroup {
  id: number
  title: string
  color?: string
  collapsed?: boolean
  windowId?: number
  tabs: BrowserGroupTab[]
  skipped: number
}

type ChromeTabGroup = {
  id: number
  title?: string
  color?: string
  collapsed?: boolean
  windowId?: number
}

type TabGroupsApi = {
  query: (
    queryInfo: Record<string, unknown>,
    callback?: (groups: ChromeTabGroup[]) => void
  ) => Promise<ChromeTabGroup[]> | undefined
}

const chromeRuntimeLastError = (): string | undefined =>
  globalThis.chrome?.runtime?.lastError?.message

const queryTabGroups = async (): Promise<ChromeTabGroup[]> => {
  const browserApi = (browser as unknown as { tabGroups?: TabGroupsApi })
    .tabGroups
  if (browserApi?.query) {
    return (await browserApi.query({})) ?? []
  }

  const api = globalThis.chrome?.tabGroups as TabGroupsApi | undefined

  if (!api?.query) return []

  try {
    const maybePromise = api.query({})
    if (maybePromise && typeof maybePromise.then === "function") {
      return await maybePromise
    }
  } catch {
    // Older callback-only surfaces can require the callback argument.
  }

  return new Promise<ChromeTabGroup[]>((resolve, reject) => {
    try {
      api.query({}, (groups) => {
        const lastError = chromeRuntimeLastError()
        if (lastError) reject(new Error(lastError))
        else resolve(groups ?? [])
      })
    } catch (error) {
      reject(error)
    }
  })
}

const toOpenTab = (tab: {
  id?: number
  title?: string
  url?: string
  active?: boolean
}): BrowserGroupTab => ({
  id: tab.id as number,
  title: tab.title || "Untitled",
  url: tab.url || "",
  active: Boolean(tab.active)
})

export const getTabGroupsAvailability = async (): Promise<
  "available" | "unsupported" | "permission"
> => {
  if (!supportsTabGroups()) return "unsupported"
  if (!(await hasPermission("tabGroups"))) return "permission"
  return "available"
}

export const requestTabGroupsAccess = async (): Promise<boolean> =>
  supportsTabGroups() && (await requestPermission("tabGroups"))

export const listAvailableBrowserTabGroups = async (): Promise<
  BrowserTabGroup[]
> => {
  const groups = await queryTabGroups()
  const excludedPatterns = await resolveExcludedUrlPatterns()
  const grouped: BrowserTabGroup[] = []

  for (const group of groups) {
    const tabs = await browser.tabs.query({ groupId: group.id })
    const readable: BrowserGroupTab[] = []
    let skipped = 0

    for (const tab of tabs) {
      if (tab.id === undefined || !tab.url) {
        skipped += 1
        continue
      }
      if (
        !isContentScriptReadableUrl(tab.url) ||
        urlMatchesAny(tab.url, excludedPatterns) ||
        (await isNeverReadUrl(tab.url))
      ) {
        skipped += 1
        continue
      }
      readable.push(toOpenTab(tab))
    }

    grouped.push({
      id: group.id,
      title: group.title?.trim() || `Group ${group.id}`,
      color: group.color,
      collapsed: group.collapsed,
      windowId: group.windowId,
      tabs: readable,
      skipped
    })
  }

  return grouped
}

export const listBrowserTabGroups = async (): Promise<BrowserTabGroup[]> => {
  if ((await getTabGroupsAvailability()) !== "available") return []
  return listAvailableBrowserTabGroups()
}
