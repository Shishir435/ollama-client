import { browser } from "@/lib/browser-api"

/**
 * Brings a run's tab and its window forward on the user's own click. The
 * agent never does this itself — it works in the background — so a handover
 * or a page to review needs a way to reach the tab it is in.
 */
export const showAgentTab = async (tabId: number): Promise<void> => {
  try {
    const tab = await browser.tabs.update(tabId, { active: true })
    if (tab?.windowId !== undefined)
      await browser.windows.update(tab.windowId, { focused: true })
  } catch {
    /** The tab closed in the meantime; there is nothing left to show. */
  }
}
