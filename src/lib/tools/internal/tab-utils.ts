import {
  resolveExcludedUrlPatterns,
  urlMatchesAny
} from "@/contents/url-filter"
import { browser } from "@/lib/browser-api"
import {
  blockedTabAccessMessage,
  isContentScriptReadableUrl
} from "@/lib/browser-tab-access"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { isNeverReadUrl } from "@/lib/per-site-profiles"
import type { ChromeResponse } from "@/types"

/** Built content-script file (see manifest `content_scripts`). */
const CONTENT_SCRIPT_FILE = "content-scripts/content.js"

export type PageContentResponse = ChromeResponse & {
  html?: string
  title?: string
}

interface TabContentCacheEntry {
  response: PageContentResponse
  url?: string
  title?: string
}

const tabContentCache = new Map<number, TabContentCacheEntry>()

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
const getCurrentTabSignature = async (tabId: number) => {
  try {
    const tab = await browser.tabs.get(tabId)
    return { url: tab.url, title: tab.title }
  } catch {
    return {}
  }
}

const cacheMatches = (
  cached: TabContentCacheEntry | undefined,
  signature: { url?: string; title?: string }
) => {
  if (!cached) return false
  // No live signature means `tabs.get` failed (tab closed, navigating, or
  // restricted). We can't confirm the cached content still matches the tab, so
  // treat it as a miss and force a refetch rather than serve stale content.
  if (!signature.url) return false
  if (cached.url && signature.url && cached.url !== signature.url) return false
  if (cached.title && signature.title && cached.title !== signature.title) {
    return false
  }
  return true
}

export const clearTabContentCache = (tabId?: number) => {
  if (tabId === undefined) tabContentCache.clear()
  else tabContentCache.delete(tabId)
}

export const readTabContent = async (
  tabId: number,
  { force = false }: { force?: boolean } = {}
): Promise<PageContentResponse> => {
  const signature = await getCurrentTabSignature(tabId)
  const cached = tabContentCache.get(tabId)
  if (!force && cached && cacheMatches(cached, signature)) {
    return cached.response
  }

  // A forced refetch must not leave a stale entry behind if the new read fails.
  if (force) tabContentCache.delete(tabId)

  const cacheAndReturn = (response: PageContentResponse) => {
    // Don't cache disabled/excluded/parse-failure placeholders — they carry an
    // explanatory string in `html` with `success: false`, and caching them
    // would pin that non-content message for the tab's lifetime.
    if (response.success === false) return response
    tabContentCache.set(tabId, {
      response,
      url: signature.url,
      title: response.title || signature.title
    })
    return response
  }

  try {
    return cacheAndReturn(await requestPageContent(tabId))
  } catch (firstError) {
    logger.debug("readTabContent: no receiver, injecting", "tabUtils", {
      error: firstError
    })
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE]
    })
    try {
      return cacheAndReturn(await requestPageContent(tabId))
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
  return urlMatchesAny(url as string, patterns) ||
    (await isNeverReadUrl(url as string))
    ? "excluded"
    : "ok"
}

/** Human-facing explanation the model can relay when a tab can't be read. */
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

/** Every tab that has an id, across all normal windows (any scheme). */
export const getAllTabs = async (): Promise<OpenTab[]> => {
  const tabs = await browser.tabs.query({})
  return tabs.filter((tab) => tab.id !== undefined).map(toOpenTab)
}

/** Tabs the extension can actually read: readable scheme and not excluded. */
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
