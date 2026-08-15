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

/** Runtime-only extractor injected when a readable tab is requested. */
const CONTENT_SCRIPT_FILE = "content-scripts/content.js"

export type PageContentResponse = ChromeResponse & {
  html?: string
  title?: string
}

interface TabContentCacheEntry {
  response: PageContentResponse
  url?: string
  title?: string
  bytes: number
}

/**
 * Bounds on the page-content cache.
 *
 * Entries hold whole extracted pages, keyed by tab id, in a background context
 * that on Firefox MV2 never unloads. `browser.tabs.onRemoved` releases a closed
 * tab's entry, but a long session with many tabs still needs a ceiling, and one
 * enormous page must not be allowed to occupy the whole budget by itself.
 */
const MAX_TAB_CONTENT_CACHE_ENTRIES = 16
const MAX_CACHED_HTML_BYTES = 1_000_000
const MAX_TAB_CONTENT_CACHE_BYTES = 4_000_000

/** Insertion order is the LRU order: a hit re-inserts, eviction takes the head. */
const tabContentCache = new Map<number, TabContentCacheEntry>()
let tabContentCacheBytes = 0

const entryBytes = (response: PageContentResponse): number =>
  (response.html?.length ?? 0) + (response.title?.length ?? 0)

const dropCacheEntry = (tabId: number): void => {
  const existing = tabContentCache.get(tabId)
  if (!existing) return
  tabContentCacheBytes -= existing.bytes
  tabContentCache.delete(tabId)
}

const evictUntilWithinBounds = (): void => {
  for (const tabId of [...tabContentCache.keys()]) {
    if (
      tabContentCache.size <= MAX_TAB_CONTENT_CACHE_ENTRIES &&
      tabContentCacheBytes <= MAX_TAB_CONTENT_CACHE_BYTES
    ) {
      return
    }
    dropCacheEntry(tabId)
  }
}

/** Move an entry to the LRU tail so the next eviction takes a colder one. */
const touchCacheEntry = (tabId: number, entry: TabContentCacheEntry): void => {
  tabContentCache.delete(tabId)
  tabContentCache.set(tabId, entry)
}

const requestPageContent = (tabId: number): Promise<PageContentResponse> =>
  browser.tabs.sendMessage(tabId, {
    type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT
  }) as Promise<PageContentResponse>

/**
 * Request page content through the runtime-only extractor. The first request
 * injects it into the tab and retries; later requests reuse that receiver until
 * navigation replaces the page. Throws when injection is blocked (restricted
 * pages); callers should pre-check with {@link classifyTabAccess}.
 */
export const requestPageContentWithRecovery = async (
  tabId: number
): Promise<PageContentResponse> => {
  try {
    return await requestPageContent(tabId)
  } catch (firstError) {
    logger.debug("requestPageContent: no receiver, injecting", "tabUtils", {
      error: firstError
    })
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE]
    })
    return await requestPageContent(tabId)
  }
}

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
  if (tabId === undefined) {
    tabContentCache.clear()
    tabContentCacheBytes = 0
    return
  }
  dropCacheEntry(tabId)
}

/**
 * Read a tab's readable content via the content script's extractor (Defuddle →
 * Readability → basic, plus YouTube/Udemy transcripts), with the
 * missing-receiver recovery from {@link requestPageContentWithRecovery} and a
 * per-tab cache keyed by the tab's url/title signature.
 */
export const readTabContent = async (
  tabId: number,
  { force = false }: { force?: boolean } = {}
): Promise<PageContentResponse> => {
  const signature = await getCurrentTabSignature(tabId)
  const cached = tabContentCache.get(tabId)
  if (!force && cached && cacheMatches(cached, signature)) {
    touchCacheEntry(tabId, cached)
    return cached.response
  }

  // A forced refetch must not leave a stale entry behind if the new read fails.
  if (force) dropCacheEntry(tabId)

  const cacheAndReturn = (response: PageContentResponse) => {
    // Don't cache disabled/excluded/parse-failure placeholders — they carry an
    // explanatory string in `html` with `success: false`, and caching them
    // would pin that non-content message for the tab's lifetime.
    if (response.success === false) return response
    const bytes = entryBytes(response)
    // An oversized page is still returned in full; it is only denied a cache
    // slot, so it can't evict every other tab to hold one document.
    if (bytes > MAX_CACHED_HTML_BYTES) {
      dropCacheEntry(tabId)
      return response
    }
    dropCacheEntry(tabId)
    tabContentCache.set(tabId, {
      response,
      url: signature.url,
      title: response.title || signature.title,
      bytes
    })
    tabContentCacheBytes += bytes
    evictUntilWithinBounds()
    return response
  }

  try {
    return cacheAndReturn(await requestPageContentWithRecovery(tabId))
  } catch (error) {
    logger.debug("readTabContent: recovery failed", "tabUtils", { error })
    throw error
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

/**
 * The active tab of the user's focused window (falling back to the current
 * window). A bare `{ active: true }` could return an active tab from a
 * NON-focused window, which is never what "the visible tab" means.
 */
export const queryActiveTab = async () =>
  (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0] ??
  (await browser.tabs.query({ active: true, currentWindow: true }))[0]

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
