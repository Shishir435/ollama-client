import { browser, supportsBookmarks, supportsHistory } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import type { VectorDocument } from "@/lib/embeddings/types"
import { deleteVectors, fromDocuments } from "@/lib/embeddings/vector-store"
import { hasPermission } from "@/lib/permissions"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { isNeverReadUrl } from "./per-site-profiles"

export type BrowserKnowledgeSource = "bookmarks" | "history"

export interface BrowserKnowledgeSourceSettings {
  enabled: boolean
  maxItems: number
  sinceDays?: number
  includeDomains: string[]
  excludeDomains: string[]
}

export interface BrowserKnowledgeSettings {
  sources: Record<BrowserKnowledgeSource, BrowserKnowledgeSourceSettings>
}

export type BrowserKnowledgeDocument = {
  pageContent: string
  metadata: Omit<VectorDocument["metadata"], "timestamp"> & {
    timestamp?: number
  }
}

export interface BrowserKnowledgeIndexResult {
  source: BrowserKnowledgeSource
  collected: number
  deletedExisting: number
  stored: number
}

const DEFAULT_SOURCE_SETTINGS: BrowserKnowledgeSourceSettings = {
  enabled: false,
  maxItems: 250,
  sinceDays: 30,
  includeDomains: [],
  excludeDomains: []
}

export const DEFAULT_BROWSER_KNOWLEDGE_SETTINGS: BrowserKnowledgeSettings = {
  sources: {
    bookmarks: {
      ...DEFAULT_SOURCE_SETTINGS,
      sinceDays: undefined
    },
    history: {
      ...DEFAULT_SOURCE_SETTINGS
    }
  }
}

const normalizeDomain = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")

const getHostname = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

const matchesDomain = (hostname: string, domain: string): boolean => {
  const normalized = normalizeDomain(domain)
  if (!normalized) return false
  return hostname === normalized || hostname.endsWith(`.${normalized}`)
}

const shouldIncludeUrl = async (
  url: string | undefined,
  settings: BrowserKnowledgeSourceSettings
): Promise<boolean> => {
  if (!url || !/^https?:\/\//i.test(url)) return false

  const hostname = getHostname(url)
  if (!hostname) return false

  const includeDomains = settings.includeDomains
    .map(normalizeDomain)
    .filter(Boolean)
  const excludeDomains = settings.excludeDomains
    .map(normalizeDomain)
    .filter(Boolean)

  if (
    includeDomains.length > 0 &&
    !includeDomains.some((domain) => matchesDomain(hostname, domain))
  ) {
    return false
  }

  if (excludeDomains.some((domain) => matchesDomain(hostname, domain))) {
    return false
  }

  return !(await isNeverReadUrl(url))
}

export const getBrowserKnowledgeSettings =
  async (): Promise<BrowserKnowledgeSettings> => {
    const stored = await getPlasmoStoredValue<
      Partial<BrowserKnowledgeSettings>
    >(STORAGE_KEYS.BROWSER.KNOWLEDGE_SOURCES)

    return {
      sources: {
        bookmarks: {
          ...DEFAULT_BROWSER_KNOWLEDGE_SETTINGS.sources.bookmarks,
          ...(stored?.sources?.bookmarks ?? {})
        },
        history: {
          ...DEFAULT_BROWSER_KNOWLEDGE_SETTINGS.sources.history,
          ...(stored?.sources?.history ?? {})
        }
      }
    }
  }

export const setBrowserKnowledgeSourceSettings = async (
  source: BrowserKnowledgeSource,
  settings: Partial<BrowserKnowledgeSourceSettings>
): Promise<BrowserKnowledgeSettings> => {
  const current = await getBrowserKnowledgeSettings()
  const next: BrowserKnowledgeSettings = {
    sources: {
      ...current.sources,
      [source]: {
        ...current.sources[source],
        ...settings
      }
    }
  }

  await setPlasmoStoredValue(STORAGE_KEYS.BROWSER.KNOWLEDGE_SOURCES, next)
  return next
}

const bookmarkNodeToDocuments = async (
  node: browser.Bookmarks.BookmarkTreeNode,
  settings: BrowserKnowledgeSourceSettings,
  documents: BrowserKnowledgeDocument[]
): Promise<void> => {
  if (node.url && (await shouldIncludeUrl(node.url, settings))) {
    const title = node.title?.trim() || node.url
    documents.push({
      pageContent: `Bookmark: ${title}\nURL: ${node.url}`,
      metadata: {
        source: "bookmarks",
        type: "webpage",
        url: node.url,
        title,
        browserSource: "bookmark",
        browserId: node.id
      }
    })
  }

  for (const child of node.children ?? []) {
    if (documents.length >= settings.maxItems) return
    await bookmarkNodeToDocuments(child, settings, documents)
  }
}

export const collectBookmarkDocuments = async (
  settings: BrowserKnowledgeSourceSettings
): Promise<BrowserKnowledgeDocument[]> => {
  if (!settings.enabled || !supportsBookmarks()) return []
  if (!(await hasPermission("bookmarks"))) return []

  const tree = await browser.bookmarks.getTree()
  const documents: BrowserKnowledgeDocument[] = []

  for (const root of tree) {
    if (documents.length >= settings.maxItems) break
    await bookmarkNodeToDocuments(root, settings, documents)
  }

  return documents.slice(0, settings.maxItems)
}

export const collectHistoryDocuments = async (
  settings: BrowserKnowledgeSourceSettings
): Promise<BrowserKnowledgeDocument[]> => {
  if (!settings.enabled || !supportsHistory()) return []
  if (!(await hasPermission("history"))) return []

  const startTime = settings.sinceDays
    ? Date.now() - settings.sinceDays * 24 * 60 * 60 * 1000
    : undefined

  const items = await browser.history.search({
    text: "",
    startTime,
    maxResults: settings.maxItems
  })

  const allowedItems = []
  for (const item of items) {
    if (await shouldIncludeUrl(item.url, settings)) {
      allowedItems.push(item)
    }
  }

  return allowedItems.slice(0, settings.maxItems).map((item) => {
    const url = item.url as string
    const title = item.title?.trim() || url
    const lastVisitTime = item.lastVisitTime ?? Date.now()

    return {
      pageContent: `History: ${title}\nURL: ${url}\nLast visited: ${new Date(
        lastVisitTime
      ).toISOString()}`,
      metadata: {
        source: "history",
        type: "webpage",
        url,
        title,
        browserSource: "history",
        browserId: item.id,
        visitCount: item.visitCount,
        lastVisitTime,
        timestamp: lastVisitTime
      }
    }
  })
}

export const getRecentHistoryItems = async (
  limit = 10
): Promise<browser.History.HistoryItem[]> => {
  if (!supportsHistory()) return []
  if (!(await hasPermission("history"))) return []

  const settings = await getBrowserKnowledgeSettings()
  const historySettings = settings.sources.history
  if (!historySettings.enabled) return []

  const clampedLimit = Math.max(1, Math.min(50, Math.floor(limit)))
  const startTime = historySettings.sinceDays
    ? Date.now() - historySettings.sinceDays * 24 * 60 * 60 * 1000
    : undefined
  const items = await browser.history.search({
    text: "",
    startTime,
    maxResults: clampedLimit
  })

  const allowedItems = []
  for (const item of items) {
    if (await shouldIncludeUrl(item.url, historySettings)) {
      allowedItems.push(item)
    }
  }

  return allowedItems.slice(0, clampedLimit)
}

export const searchBookmarkItems = async (
  query: string,
  limit = 10
): Promise<browser.Bookmarks.BookmarkTreeNode[]> => {
  if (!supportsBookmarks()) return []
  if (!(await hasPermission("bookmarks"))) return []

  const settings = await getBrowserKnowledgeSettings()
  const bookmarkSettings = settings.sources.bookmarks
  if (!bookmarkSettings.enabled) return []

  const trimmed = query.trim()
  const matches = trimmed
    ? await browser.bookmarks.search(trimmed)
    : await browser.bookmarks.search({})

  const allowedItems = []
  for (const item of matches) {
    if (await shouldIncludeUrl(item.url, bookmarkSettings)) {
      allowedItems.push(item)
    }
  }

  return allowedItems.slice(0, Math.max(1, Math.min(50, Math.floor(limit))))
}

export const collectBrowserKnowledgeDocuments = async (
  settings?: BrowserKnowledgeSettings
): Promise<BrowserKnowledgeDocument[]> => {
  const resolved = settings ?? (await getBrowserKnowledgeSettings())
  const [bookmarks, history] = await Promise.all([
    collectBookmarkDocuments(resolved.sources.bookmarks),
    collectHistoryDocuments(resolved.sources.history)
  ])

  return [...bookmarks, ...history]
}

export const forgetBrowserKnowledgeSource = async (
  source: BrowserKnowledgeSource
): Promise<number> => {
  return deleteVectors({ type: "webpage", source })
}

export const indexBrowserKnowledgeSource = async (
  source: BrowserKnowledgeSource,
  settings?: BrowserKnowledgeSettings
): Promise<BrowserKnowledgeIndexResult> => {
  const resolved = settings ?? (await getBrowserKnowledgeSettings())
  const sourceSettings = resolved.sources[source]

  if (!sourceSettings.enabled) {
    return { source, collected: 0, deletedExisting: 0, stored: 0 }
  }

  const documents =
    source === "bookmarks"
      ? await collectBookmarkDocuments(sourceSettings)
      : await collectHistoryDocuments(sourceSettings)

  if (documents.length === 0) {
    return { source, collected: 0, deletedExisting: 0, stored: 0 }
  }

  const runId = `${source}-${Date.now()}`
  const indexedDocuments = documents.map((document) => ({
    ...document,
    metadata: {
      ...document.metadata,
      browserIndexRunId: runId
    }
  }))
  const storedIds = await fromDocuments(indexedDocuments)
  const deletedExisting =
    storedIds.length === documents.length
      ? await deleteVectors({
          type: "webpage",
          source,
          excludeBrowserIndexRunId: runId
        })
      : 0

  return {
    source,
    collected: documents.length,
    deletedExisting,
    stored: storedIds.length
  }
}

export const indexBrowserKnowledgeSources = async (
  settings?: BrowserKnowledgeSettings
): Promise<BrowserKnowledgeIndexResult[]> => {
  const resolved = settings ?? (await getBrowserKnowledgeSettings())
  const sources = Object.entries(resolved.sources)
    .filter(([, sourceSettings]) => sourceSettings.enabled)
    .map(([source]) => source as BrowserKnowledgeSource)

  const results: BrowserKnowledgeIndexResult[] = []
  for (const source of sources) {
    results.push(await indexBrowserKnowledgeSource(source, resolved))
  }

  return results
}
