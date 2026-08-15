import { browser } from "@/lib/browser-api"
import { clearTabContentCache } from "@/lib/tools/internal/tab-utils"

/**
 * Release a closed tab's cached page content.
 *
 * The cache holds whole extracted documents keyed by tab id. On Firefox MV2 the
 * background page never unloads, so without this the entries of every tab the
 * user ever opened survive for the whole browser session.
 */
export const registerTabLifecycle = (): void => {
  if (typeof browser.tabs?.onRemoved?.addListener !== "function") return
  browser.tabs.onRemoved.addListener((tabId: number) => {
    clearTabContentCache(tabId)
  })
}
