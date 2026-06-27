import { browser, supportsBookmarks, supportsHistory } from "@/lib/browser-api"
import { hasPermission } from "@/lib/permissions"
import { isNeverReadUrl } from "./per-site-profiles"

const isReadableBrowserUrl = async (
  url: string | undefined
): Promise<boolean> =>
  Boolean(url && /^https?:\/\//i.test(url) && !(await isNeverReadUrl(url)))

export const getRecentHistoryItems = async (
  limit = 10
): Promise<browser.History.HistoryItem[]> => {
  if (!supportsHistory() || !(await hasPermission("history"))) return []

  const clampedLimit = Math.max(1, Math.min(50, Math.floor(limit)))
  const items = await browser.history.search({
    text: "",
    maxResults: clampedLimit
  })

  const allowedItems = []
  for (const item of items) {
    if (await isReadableBrowserUrl(item.url)) allowedItems.push(item)
  }

  return allowedItems.slice(0, clampedLimit)
}

export const searchBookmarkItems = async (
  query: string,
  limit = 10
): Promise<browser.Bookmarks.BookmarkTreeNode[]> => {
  if (!supportsBookmarks() || !(await hasPermission("bookmarks"))) return []

  const trimmed = query.trim()
  const matches = trimmed
    ? await browser.bookmarks.search(trimmed)
    : await browser.bookmarks.search({})

  const allowedItems = []
  for (const item of matches) {
    if (await isReadableBrowserUrl(item.url)) allowedItems.push(item)
  }

  return allowedItems.slice(0, Math.max(1, Math.min(50, Math.floor(limit))))
}
