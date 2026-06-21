import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  getPlasmoStoredValue: vi.fn(),
  setPlasmoStoredValue: vi.fn(),
  getTree: vi.fn(),
  search: vi.fn(),
  deleteVectors: vi.fn(),
  fromDocuments: vi.fn()
}))

vi.mock("@/lib/permissions", () => ({
  hasPermission: mocks.hasPermission
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: mocks.getPlasmoStoredValue,
  setPlasmoStoredValue: mocks.setPlasmoStoredValue
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    bookmarks: { getTree: mocks.getTree },
    history: { search: mocks.search }
  },
  supportsBookmarks: () => true,
  supportsHistory: () => true
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  deleteVectors: mocks.deleteVectors,
  fromDocuments: mocks.fromDocuments
}))

describe("browser knowledge sources", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasPermission.mockResolvedValue(true)
    mocks.getPlasmoStoredValue.mockResolvedValue(undefined)
    mocks.deleteVectors.mockResolvedValue(0)
    mocks.fromDocuments.mockResolvedValue([1])
  })

  it("merges stored source settings over privacy-safe defaults", async () => {
    const { getBrowserKnowledgeSettings } = await import(
      "@/lib/browser-knowledge"
    )

    mocks.getPlasmoStoredValue.mockResolvedValue({
      sources: {
        history: {
          enabled: true,
          maxItems: 50,
          includeDomains: ["example.com"]
        }
      }
    })

    await expect(getBrowserKnowledgeSettings()).resolves.toMatchObject({
      sources: {
        bookmarks: { enabled: false, maxItems: 250 },
        history: {
          enabled: true,
          maxItems: 50,
          sinceDays: 30,
          includeDomains: ["example.com"],
          excludeDomains: []
        }
      }
    })
  })

  it("collects only allowed bookmark URLs when permission is granted", async () => {
    const { collectBookmarkDocuments } = await import("@/lib/browser-knowledge")

    mocks.getTree.mockResolvedValue([
      {
        id: "root",
        title: "root",
        children: [
          { id: "1", title: "Docs", url: "https://docs.example.com/a" },
          { id: "2", title: "Other", url: "https://other.test/a" },
          { id: "3", title: "Internal", url: "chrome://extensions" }
        ]
      }
    ])

    const docs = await collectBookmarkDocuments({
      enabled: true,
      maxItems: 10,
      includeDomains: ["example.com"],
      excludeDomains: [],
      sinceDays: undefined
    })

    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      pageContent: "Bookmark: Docs\nURL: https://docs.example.com/a",
      metadata: {
        source: "bookmarks",
        type: "webpage",
        url: "https://docs.example.com/a",
        browserSource: "bookmark",
        browserId: "1"
      }
    })
  })

  it("does not collect history without optional permission", async () => {
    const { collectHistoryDocuments } = await import("@/lib/browser-knowledge")

    mocks.hasPermission.mockResolvedValue(false)

    await expect(
      collectHistoryDocuments({
        enabled: true,
        maxItems: 10,
        sinceDays: 7,
        includeDomains: [],
        excludeDomains: []
      })
    ).resolves.toEqual([])
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it("collects scoped history records with visit metadata", async () => {
    const { collectHistoryDocuments } = await import("@/lib/browser-knowledge")

    mocks.search.mockResolvedValue([
      {
        id: "10",
        title: "Article",
        url: "https://news.example.com/post",
        visitCount: 3,
        lastVisitTime: 1710000000000
      },
      {
        id: "11",
        title: "Blocked",
        url: "https://blocked.example.com/post"
      }
    ])

    const docs = await collectHistoryDocuments({
      enabled: true,
      maxItems: 5,
      sinceDays: 14,
      includeDomains: [],
      excludeDomains: ["blocked.example.com"]
    })

    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ text: "", maxResults: 5 })
    )
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      metadata: {
        source: "history",
        type: "webpage",
        url: "https://news.example.com/post",
        browserSource: "history",
        browserId: "10",
        visitCount: 3,
        lastVisitTime: 1710000000000,
        timestamp: 1710000000000
      }
    })
  })

  it("reindexes enabled browser sources through the vector-store facade", async () => {
    const { indexBrowserKnowledgeSources } = await import(
      "@/lib/browser-knowledge"
    )

    mocks.getTree.mockResolvedValue([
      {
        id: "root",
        title: "root",
        children: [{ id: "1", title: "Docs", url: "https://example.com/a" }]
      }
    ])
    mocks.search.mockResolvedValue([
      {
        id: "10",
        title: "Article",
        url: "https://news.example.com/post",
        lastVisitTime: 1710000000000
      }
    ])
    mocks.deleteVectors.mockResolvedValueOnce(2).mockResolvedValueOnce(3)
    mocks.fromDocuments
      .mockResolvedValueOnce([101])
      .mockResolvedValueOnce([201])

    await expect(
      indexBrowserKnowledgeSources({
        sources: {
          bookmarks: {
            enabled: true,
            maxItems: 10,
            sinceDays: undefined,
            includeDomains: [],
            excludeDomains: []
          },
          history: {
            enabled: true,
            maxItems: 10,
            sinceDays: 7,
            includeDomains: [],
            excludeDomains: []
          }
        }
      })
    ).resolves.toEqual([
      { source: "bookmarks", collected: 1, deletedExisting: 2, stored: 1 },
      { source: "history", collected: 1, deletedExisting: 3, stored: 1 }
    ])

    expect(mocks.deleteVectors).toHaveBeenCalledWith({
      type: "webpage",
      source: "bookmarks"
    })
    expect(mocks.deleteVectors).toHaveBeenCalledWith({
      type: "webpage",
      source: "history"
    })
    expect(mocks.fromDocuments).toHaveBeenCalledTimes(2)
  })
})
