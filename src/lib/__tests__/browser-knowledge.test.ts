import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getRecentHistoryItems,
  searchBookmarkItems
} from "@/lib/browser-knowledge"

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  supportsBookmarks: vi.fn(),
  supportsHistory: vi.fn(),
  historySearch: vi.fn(),
  bookmarkSearch: vi.fn(),
  isNeverReadUrl: vi.fn()
}))

vi.mock("@/lib/permissions", () => ({
  hasPermission: mocks.hasPermission
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    bookmarks: { search: mocks.bookmarkSearch },
    history: { search: mocks.historySearch }
  },
  supportsBookmarks: mocks.supportsBookmarks,
  supportsHistory: mocks.supportsHistory
}))

vi.mock("@/lib/per-site-profiles", () => ({
  isNeverReadUrl: mocks.isNeverReadUrl
}))

describe("browser knowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasPermission.mockResolvedValue(true)
    mocks.supportsBookmarks.mockReturnValue(true)
    mocks.supportsHistory.mockReturnValue(true)
    mocks.isNeverReadUrl.mockResolvedValue(false)
  })

  it("does not search bookmarks without permission", async () => {
    mocks.hasPermission.mockResolvedValue(false)

    await expect(searchBookmarkItems("docs")).resolves.toEqual([])
    expect(mocks.bookmarkSearch).not.toHaveBeenCalled()
  })

  it("searches bookmarks and filters unreadable URLs", async () => {
    mocks.isNeverReadUrl.mockImplementation((url: string) =>
      Promise.resolve(url.includes("private.test"))
    )
    mocks.bookmarkSearch.mockResolvedValue([
      { id: "1", title: "Docs", url: "https://docs.test" },
      { id: "2", title: "Private", url: "https://private.test" },
      { id: "3", title: "Internal", url: "chrome://extensions" }
    ])

    await expect(searchBookmarkItems(" docs ", 10)).resolves.toEqual([
      { id: "1", title: "Docs", url: "https://docs.test" }
    ])
    expect(mocks.bookmarkSearch).toHaveBeenCalledWith("docs")
  })

  it("lists bookmarks when query is empty", async () => {
    mocks.bookmarkSearch.mockResolvedValue([])

    await searchBookmarkItems("  ")

    expect(mocks.bookmarkSearch).toHaveBeenCalledWith({})
  })

  it("does not read history without permission", async () => {
    mocks.hasPermission.mockResolvedValue(false)

    await expect(getRecentHistoryItems()).resolves.toEqual([])
    expect(mocks.historySearch).not.toHaveBeenCalled()
  })

  it("reads recent history and filters never-read URLs", async () => {
    mocks.isNeverReadUrl.mockImplementation((url: string) =>
      Promise.resolve(url.includes("private.test"))
    )
    mocks.historySearch.mockResolvedValue([
      { id: "1", title: "Docs", url: "https://docs.test" },
      { id: "2", title: "Private", url: "https://private.test" }
    ])

    await expect(getRecentHistoryItems(100)).resolves.toEqual([
      { id: "1", title: "Docs", url: "https://docs.test" }
    ])
    expect(mocks.historySearch).toHaveBeenCalledWith({
      text: "",
      maxResults: 50
    })
  })
})
