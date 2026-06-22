import { beforeEach, describe, expect, it, vi } from "vitest"
import { urlMatchesAny } from "@/contents/url-filter"
import { browser, supportsTabGroups } from "@/lib/browser-api"
import {
  getTabGroupsAvailability,
  listBrowserTabGroups
} from "@/lib/browser-tab-groups"
import { isNeverReadUrl } from "@/lib/per-site-profiles"
import { hasPermission } from "@/lib/permissions"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: {
      query: vi.fn()
    }
  },
  supportsTabGroups: vi.fn()
}))

vi.mock("@/lib/permissions", () => ({
  hasPermission: vi.fn(),
  requestPermission: vi.fn()
}))

vi.mock("@/contents/url-filter", () => ({
  resolveExcludedUrlPatterns: vi.fn(async () => ["excluded.test"]),
  urlMatchesAny: vi.fn((url: string) => url.includes("excluded.test"))
}))

vi.mock("@/lib/per-site-profiles", () => ({
  isNeverReadUrl: vi.fn(async (url: string) => url.includes("never.test"))
}))

describe("browser tab groups", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.chrome = {
      runtime: {},
      tabGroups: {
        query: vi.fn((_queryInfo, callback) => {
          callback?.([
            {
              id: 5,
              title: "Research",
              color: "blue",
              collapsed: false,
              windowId: 1
            }
          ])
        })
      }
    } as unknown as typeof chrome
  })

  it("reports unsupported and permission states", async () => {
    vi.mocked(supportsTabGroups).mockReturnValue(false)
    expect(await getTabGroupsAvailability()).toBe("unsupported")

    vi.mocked(supportsTabGroups).mockReturnValue(true)
    vi.mocked(hasPermission).mockResolvedValue(false)
    expect(await getTabGroupsAvailability()).toBe("permission")
  })

  it("lists group tabs and filters unreadable, excluded, and never-read URLs", async () => {
    vi.mocked(supportsTabGroups).mockReturnValue(true)
    vi.mocked(hasPermission).mockResolvedValue(true)
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        id: 1,
        title: "Docs",
        url: "https://docs.test",
        active: true
      },
      {
        id: 2,
        title: "Internal",
        url: "chrome://extensions"
      },
      {
        id: 3,
        title: "Excluded",
        url: "https://excluded.test/page"
      },
      {
        id: 4,
        title: "Never",
        url: "https://never.test/page"
      }
    ] as never)

    const groups = await listBrowserTabGroups()

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: 5,
      title: "Research",
      skipped: 3
    })
    expect(groups[0].tabs).toEqual([
      {
        id: 1,
        title: "Docs",
        url: "https://docs.test",
        active: true
      }
    ])
    expect(browser.tabs.query).toHaveBeenCalledWith({ groupId: 5 })
    expect(urlMatchesAny).toHaveBeenCalled()
    expect(isNeverReadUrl).toHaveBeenCalledWith("https://never.test/page")
  })

  it("uses promise-based browser.tabGroups when available", async () => {
    vi.mocked(supportsTabGroups).mockReturnValue(true)
    vi.mocked(hasPermission).mockResolvedValue(true)
    const browserTabGroupsQuery = vi.fn().mockResolvedValue([
      {
        id: 8,
        title: "Firefox group"
      }
    ])
    ;(
      browser as unknown as {
        tabGroups: { query: typeof browserTabGroupsQuery }
      }
    ).tabGroups = {
      query: browserTabGroupsQuery
    }
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        id: 10,
        title: "MDN",
        url: "https://developer.mozilla.org",
        active: false
      }
    ] as never)

    const groups = await listBrowserTabGroups()

    expect(groups[0].title).toBe("Firefox group")
    expect(browserTabGroupsQuery).toHaveBeenCalledWith({})
    expect(globalThis.chrome?.tabGroups?.query).not.toHaveBeenCalled()
  })
})
