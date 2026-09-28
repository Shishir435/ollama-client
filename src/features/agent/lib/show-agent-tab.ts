import { browser } from "@/lib/browser-api"
import { normalizeGrantOrigin } from "@/lib/tools/approval/approval-policy"

/**
 * Brings a run's tab and its window forward on the user's own click. The
 * agent never does this itself — it works in the background — so a handover
 * or a page to review needs a way to reach the tab it is in.
 *
 * The tab is checked again at the click, not when the card loaded: a settled
 * card stops refreshing, and the tab may have left the run's sites since.
 */
export const showAgentTab = async (
  tabId: number,
  allowedOrigins: readonly string[]
): Promise<void> => {
  try {
    const current = await browser.tabs.get(tabId)
    const origin = normalizeGrantOrigin(current?.url)
    if (!origin || !allowedOrigins.includes(origin)) return
    const tab = await browser.tabs.update(tabId, { active: true })
    if (tab?.windowId !== undefined)
      await browser.windows.update(tab.windowId, { focused: true })
  } catch {
    /** The tab closed in the meantime; there is nothing left to show. */
  }
}
