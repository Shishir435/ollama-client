import {
  resolveExcludedUrlPatterns,
  urlMatchesAny
} from "@/contents/url-filter"
import { browser } from "@/lib/browser-api"
import { isNeverReadUrl } from "@/lib/per-site-profiles"

/** URL schemes where a content script can run at all. */
export const isReadableTabScheme = (url?: string): boolean =>
  !!url && /^(https?|file|ftp):/i.test(url)

/** Browser-owned extension galleries block content scripts despite HTTPS. */
export const isExtensionGalleryUrl = (url?: string): boolean => {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.hostname === "chromewebstore.google.com" ||
    (parsed.hostname === "chrome.google.com" &&
      parsed.pathname.includes("/webstore"))
  )
}

export const isContentScriptReadableUrl = (url?: string): boolean =>
  isReadableTabScheme(url) && !isExtensionGalleryUrl(url)

export const blockedTabAccessMessage = (label: string): string =>
  `Can't read ${label} — the browser blocks extensions on internal pages and extension galleries (chrome://, Chrome Web Store, etc.). Do not retry this same tab; answer from visible tab metadata or ask the user to switch/share details.`

export interface OpenTab {
  id: number
  title: string
  url: string
  active: boolean
}

export type TabAccess = "ok" | "restricted" | "excluded"

export const classifyTabAccess = async (url?: string): Promise<TabAccess> => {
  if (!isContentScriptReadableUrl(url)) return "restricted"
  const patterns = await resolveExcludedUrlPatterns()
  return urlMatchesAny(url as string, patterns) ||
    (await isNeverReadUrl(url as string))
    ? "excluded"
    : "ok"
}

/** Agent is stricter than general tab tools: it never reads file or FTP pages. */
export const classifyAgentTabAccess = async (
  url?: string
): Promise<TabAccess> => {
  if (!url || !/^https?:/i.test(url)) return "restricted"
  return classifyTabAccess(url)
}

export const accessDeniedMessage = (
  access: "restricted" | "excluded",
  label: string
): string =>
  access === "restricted"
    ? blockedTabAccessMessage(label)
    : `Can't read ${label} — this site is excluded in your content-extraction settings.`

const toOpenTab = (tab: {
  id?: number
  title?: string
  url?: string
  active?: boolean
}): OpenTab => ({
  id: tab.id as number,
  title: tab.title || "Untitled",
  url: tab.url || "",
  active: Boolean(tab.active)
})

export const queryActiveTab = async () =>
  (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0] ??
  (await browser.tabs.query({ active: true, currentWindow: true }))[0]

export const getAllTabs = async (): Promise<OpenTab[]> => {
  const tabs = await browser.tabs.query({})
  return tabs.filter((tab) => tab.id !== undefined).map(toOpenTab)
}

export const listReadableTabs = async (): Promise<OpenTab[]> => {
  const tabs = await getAllTabs()
  const patterns = await resolveExcludedUrlPatterns()
  const readable: OpenTab[] = []
  for (const tab of tabs) {
    if (!isContentScriptReadableUrl(tab.url)) continue
    if (urlMatchesAny(tab.url, patterns)) continue
    if (await isNeverReadUrl(tab.url)) continue
    readable.push(tab)
  }
  return readable
}
