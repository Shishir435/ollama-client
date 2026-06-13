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

/** URL schemes where extensions cannot run content scripts. */
const isReadableUrl = (url?: string): boolean =>
  !!url && /^(https?|file|ftp):/i.test(url)

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
 * retrying once. Throws on restricted pages (chrome://, web store) where
 * injection is blocked.
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
    return requestPageContent(tabId)
  }
}

export interface OpenTab {
  id: number
  title: string
  url: string
  active: boolean
}

/** All readable (http/file) tabs across normal windows, active tab last-known. */
export const listReadableTabs = async (): Promise<OpenTab[]> => {
  const tabs = await browser.tabs.query({})
  return tabs
    .filter((tab) => tab.id !== undefined && isReadableUrl(tab.url))
    .map((tab) => ({
      id: tab.id as number,
      title: tab.title || "Untitled",
      url: tab.url as string,
      active: Boolean(tab.active)
    }))
}
