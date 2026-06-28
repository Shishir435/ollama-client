import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getRecentlyClosed: vi.fn(),
  getDevices: vi.fn(),
  hasPermission: vi.fn(),
  isNeverReadUrl: vi.fn(),
  supportsSessions: vi.fn(),
  supportsSyncedSessions: vi.fn(),
  resolveExcludedUrlPatterns: vi.fn(),
  urlMatchesAny: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    sessions: {
      getRecentlyClosed: mocks.getRecentlyClosed,
      getDevices: mocks.getDevices
    }
  },
  supportsSessions: mocks.supportsSessions,
  supportsSyncedSessions: mocks.supportsSyncedSessions
}))

vi.mock("@/lib/permissions", () => ({
  hasPermission: mocks.hasPermission
}))

vi.mock("@/lib/per-site-profiles", () => ({
  isNeverReadUrl: mocks.isNeverReadUrl
}))

vi.mock("@/contents/url-filter", () => ({
  resolveExcludedUrlPatterns: mocks.resolveExcludedUrlPatterns,
  urlMatchesAny: mocks.urlMatchesAny
}))

import {
  getBrowserSessionsAvailability,
  listRecentlyClosedBrowserSessions,
  listSyncedBrowserSessions
} from "@/lib/browser-sessions"

describe("browser sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.supportsSessions.mockReturnValue(true)
    mocks.supportsSyncedSessions.mockReturnValue(true)
    mocks.hasPermission.mockResolvedValue(true)
    mocks.isNeverReadUrl.mockResolvedValue(false)
    mocks.resolveExcludedUrlPatterns.mockResolvedValue([])
    mocks.urlMatchesAny.mockReturnValue(false)
  })

  it("reports unsupported and missing-permission states", async () => {
    mocks.supportsSessions.mockReturnValue(false)
    await expect(getBrowserSessionsAvailability()).resolves.toBe("unsupported")

    mocks.supportsSessions.mockReturnValue(true)
    mocks.hasPermission.mockResolvedValue(false)
    await expect(getBrowserSessionsAvailability()).resolves.toBe("permission")
  })

  it("filters internal and never-read recently closed tabs", async () => {
    mocks.isNeverReadUrl.mockImplementation(async (url: string) =>
      url.includes("private.test")
    )
    mocks.getRecentlyClosed.mockResolvedValue([
      {
        lastModified: 1_750_000_000,
        tab: {
          sessionId: "safe",
          title: "Docs",
          url: "https://docs.test/page"
        }
      },
      {
        tab: {
          sessionId: "private",
          title: "Private",
          url: "https://private.test/inbox"
        }
      },
      {
        tab: {
          sessionId: "internal",
          title: "Settings",
          url: "chrome://settings"
        }
      }
    ])

    const result = await listRecentlyClosedBrowserSessions(5)

    expect(mocks.getRecentlyClosed).toHaveBeenCalledWith({ maxResults: 5 })
    expect(result.skipped).toBe(2)
    expect(result.sessions).toEqual([
      expect.objectContaining({
        sessionId: "safe",
        title: "Docs",
        url: "https://docs.test/page",
        lastModified: 1_750_000_000_000
      })
    ])
  })

  it("filters configured excluded URL patterns", async () => {
    mocks.resolveExcludedUrlPatterns.mockResolvedValue(["private.example"])
    mocks.urlMatchesAny.mockImplementation((url: string) =>
      url.includes("private.example")
    )
    mocks.getRecentlyClosed.mockResolvedValue([
      { tab: { title: "Allowed", url: "https://allowed.example" } },
      { tab: { title: "Excluded", url: "https://private.example" } }
    ])

    const result = await listRecentlyClosedBrowserSessions()

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].title).toBe("Allowed")
    expect(result.skipped).toBe(1)
  })

  it("keeps readable tabs from a closed window", async () => {
    mocks.getRecentlyClosed.mockResolvedValue([
      {
        window: {
          sessionId: "window-1",
          tabs: [
            { title: "One", url: "https://one.test" },
            { title: "Blocked", url: "about:config" },
            { title: "Two", url: "https://two.test" }
          ]
        }
      }
    ])

    const result = await listRecentlyClosedBrowserSessions()

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        sessionId: "window-1",
        kind: "window",
        title: "2 recently closed tabs",
        tabs: [
          { title: "One", url: "https://one.test" },
          { title: "Two", url: "https://two.test" }
        ]
      })
    )
  })

  it("filters synced-device sessions with the same privacy rules", async () => {
    mocks.isNeverReadUrl.mockImplementation(async (url: string) =>
      url.includes("secret.test")
    )
    mocks.getDevices.mockResolvedValue([
      {
        deviceName: "Laptop",
        sessions: [
          { tab: { title: "Public", url: "https://public.test" } },
          { tab: { title: "Secret", url: "https://secret.test" } }
        ]
      }
    ])

    const result = await listSyncedBrowserSessions(8)

    expect(mocks.getDevices).toHaveBeenCalledWith({ maxResults: 8 })
    expect(result[0].deviceName).toBe("Laptop")
    expect(result[0].result.sessions).toHaveLength(1)
    expect(result[0].result.skipped).toBe(1)
  })
})
