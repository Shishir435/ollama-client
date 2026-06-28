import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  recentlyClosed: vi.fn(),
  synced: vi.fn()
}))

vi.mock("@/lib/browser-sessions", () => ({
  getBrowserSessionsAvailability: mocks.availability,
  listRecentlyClosedBrowserSessions: mocks.recentlyClosed,
  listSyncedBrowserSessions: mocks.synced
}))

import {
  runListRecentlyClosed,
  runListSyncedSessions
} from "@/lib/tools/internal/browser-session-tools"

describe("browser session tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.availability.mockResolvedValue("available")
  })

  it("does not query sessions without permission", async () => {
    mocks.availability.mockResolvedValue("permission")

    const result = await runListRecentlyClosed({}, {})

    expect(result.isError).toBe(true)
    expect(result.content).toContain("permission")
    expect(mocks.recentlyClosed).not.toHaveBeenCalled()
  })

  it("lists readable recently closed sources", async () => {
    mocks.recentlyClosed.mockResolvedValue({
      skipped: 1,
      sessions: [
        {
          kind: "tab",
          title: "Docs",
          url: "https://docs.test",
          tabs: [{ title: "Docs", url: "https://docs.test" }]
        }
      ]
    })

    const result = await runListRecentlyClosed({ limit: 200 }, {})

    expect(mocks.recentlyClosed).toHaveBeenCalledWith(25)
    expect(result.content).toContain("Docs")
    expect(result.content).toContain("1 excluded")
    expect(result.sources).toEqual([
      { title: "Docs", url: "https://docs.test" }
    ])
  })

  it("groups synced sessions by device", async () => {
    mocks.synced.mockResolvedValue([
      {
        deviceName: "Phone",
        result: {
          skipped: 0,
          sessions: [
            {
              kind: "tab",
              title: "News",
              url: "https://news.test",
              tabs: [{ title: "News", url: "https://news.test" }]
            }
          ]
        }
      }
    ])

    const result = await runListSyncedSessions({}, {})

    expect(result.content).toContain("Phone")
    expect(result.content).toContain("News")
  })
})
