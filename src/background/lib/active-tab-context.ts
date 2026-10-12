import type { ActiveTabContext } from "@/background/lib/build-tool-system-guidance"
import { browser } from "@/lib/browser-api"
import { classifyTabAccess } from "@/lib/browser-tab-access"
import { logger } from "@/lib/logger"

/**
 * The address without its query or fragment.
 *
 * The metadata rides every turn that offers a tab tool, before the model has
 * asked to read anything, so it carries where the page is and not what the
 * address happens to hold: a query string is where sites put search terms,
 * session tokens and one-time codes. The model reads the whole page through
 * `current_tab` when it needs more.
 */
const withoutQuery = (url: string): string | undefined => {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return undefined
  }
}

/**
 * The side panel's tab as turn context, or nothing.
 *
 * The panel sends the tab it showed when the message was sent; a turn without
 * one (a restart, a caller that is not the panel) gets no metadata rather
 * than a guess at some other window's tab. A tab `current_tab` could not read
 * — browser-internal, excluded by the user, never-read — contributes nothing.
 */
export const resolveActiveTabContext = async (
  tabId: number | undefined
): Promise<ActiveTabContext | undefined> => {
  if (tabId === undefined) return undefined
  try {
    const tab = await browser.tabs.get(tabId)
    if (!tab?.url || tab.incognito) return undefined
    if ((await classifyTabAccess(tab.url)) !== "ok") return undefined
    const url = withoutQuery(tab.url)
    return url ? { title: tab.title ?? "", url } : undefined
  } catch (error) {
    logger.debug("Active tab context unavailable", "activeTabContext", {
      error
    })
    return undefined
  }
}
