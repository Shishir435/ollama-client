import {
  resolveExcludedUrlPatterns,
  urlMatchesAny
} from "@/contents/url-filter"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { ChromeResponse } from "@/types"

/** Built content-script file (see manifest `content_scripts`). */
const CONTENT_SCRIPT_FILE = "content-scripts/content.js"

export type PageContentResponse = ChromeResponse & {
  html?: string
  title?: string
}

/** URL schemes where a content script can run at all. */
const isReadableScheme = (url?: string): boolean =>
  !!url && /^(https?|file|ftp):/i.test(url)

/** Browser-owned extension galleries block content scripts despite HTTPS. */
const isExtensionGalleryUrl = (url?: string): boolean => {
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
      parsed.pathname.startsWith("/webstore"))
  )
}

const isContentScriptReadableUrl = (url?: string): boolean =>
  isReadableScheme(url) && !isExtensionGalleryUrl(url)

const requestPageContent = (tabId: number): Promise<PageContentResponse> =>
  browser.tabs.sendMessage(tabId, {
    type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT
  }) as Promise<PageContentResponse>

/**
 * Read a tab's readable content via the content script's extractor (Defuddle →
 * Readability → basic, plus YouTube/Udemy transcripts).
 *
 * The content script is matched on `<all_urls>` but only exists on tabs that
 * loaded *after* the extension did, so a stale tab (common just after an
 * extension reload) has no receiver and `sendMessage` rejects with "Receiving
 * end does not exist." We recover by injecting the content script on demand and
 * retrying once — no page refresh needed. Throws on restricted pages where
 * injection is blocked (callers should pre-check with {@link classifyTabAccess}).
 */
export const readTabContent = async (
  tabId: number
): Promise<PageContentResponse> => {
  try {
    return await requestPageContent(tabId)
  } catch (firstError) {
    logger.debug("readTabContent: no receiver, injecting", "tabUtils", {
      error: firstError
    })
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE]
    })
    try {
      return await requestPageContent(tabId)
    } catch (retryError) {
      logger.debug("readTabContent: retry failed", "tabUtils", {
        error: retryError
      })
      throw retryError
    }
  }
}

export interface OpenTab {
  id: number
  title: string
  url: string
  active: boolean
}

export type TabAccess =
  /** Readable by the extension. */
  | "ok"
  /** Browser-internal/unsupported scheme (chrome://, web store, etc.). */
  | "restricted"
  /** Readable scheme, but the user excluded it via settings. */
  | "excluded"

/** Classify whether a tab's URL can be read, honoring the user's exclude list. */
export const classifyTabAccess = async (url?: string): Promise<TabAccess> => {
  if (!isContentScriptReadableUrl(url)) return "restricted"
  const patterns = await resolveExcludedUrlPatterns()
  return urlMatchesAny(url as string, patterns) ? "excluded" : "ok"
}

/** Human-facing explanation the model can relay when a tab can't be read. */
export const accessDeniedMessage = (
  access: "restricted" | "excluded",
  label: string
): string =>
  access === "restricted"
    ? `Can't read ${label} — the browser blocks extensions on internal pages and extension galleries (chrome://, Chrome Web Store, etc.). Do not retry this same tab; answer from visible tab metadata or ask the user to switch/share details.`
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

/** Every tab that has an id, across all normal windows (any scheme). */
export const getAllTabs = async (): Promise<OpenTab[]> => {
  const tabs = await browser.tabs.query({})
  return tabs.filter((tab) => tab.id !== undefined).map(toOpenTab)
}

/** Tabs the extension can actually read: readable scheme and not excluded. */
export const listReadableTabs = async (): Promise<OpenTab[]> => {
  const tabs = await getAllTabs()
  const patterns = await resolveExcludedUrlPatterns()
  return tabs.filter(
    (tab) =>
      isContentScriptReadableUrl(tab.url) && !urlMatchesAny(tab.url, patterns)
  )
}
