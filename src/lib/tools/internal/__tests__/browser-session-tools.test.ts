import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  recentlyClosed: vi.fn(),
  synced: vi.fn(),
  restore: vi.fn(),
  storageGet: vi.fn()
}))

vi.mock("@/lib/browser-sessions", () => ({
  getBrowserSessionsAvailability: mocks.availability,
  listRecentlyClosedBrowserSessions: mocks.recentlyClosed,
  listSyncedBrowserSessions: mocks.synced,
  restoreBrowserSession: mocks.restore
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: { get: mocks.storageGet }
}))

import {
  runListRecentlyClosed,
  runListSyncedSessions,
  runRestoreSession
} from "@/lib/tools/internal/browser-session-tools"

describe("browser session tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.availability.mockResolvedValue("available")
    // Default: no stored cap → tool falls back to DEFAULT_MAX_RESTORE_SESSIONS.
    mocks.storageGet.mockResolvedValue(undefined)
  })

  it("does not query sessions without permission", async () => {
    mocks.availability.mockResolvedValue("permission")

    const result = await runListRecentlyClosed({}, {})

    expect(result.isError).toBe(true)
    expect(result.content).toContain(
      "permission is not granted or was disabled"
    )
    expect(mocks.recentlyClosed).not.toHaveBeenCalled()
  })

  it("lists readable recently closed sources with restore ids", async () => {
    mocks.recentlyClosed.mockResolvedValue({
      skipped: 1,
      sessions: [
        {
          sessionId: "tab-9",
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
    expect(result.content).toContain("[id: tab-9]")
    expect(result.content).toContain("1 excluded")
    expect(result.sources).toEqual([
      { title: "Docs", url: "https://docs.test" }
    ])
  })

  it("restores a session by id", async () => {
    mocks.restore.mockResolvedValue(undefined)

    const result = await runRestoreSession({ sessionId: "tab-9" }, {})

    expect(mocks.restore).toHaveBeenCalledWith("tab-9")
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain("tab-9")
  })

  it("restores the most recent session when no id is given", async () => {
    mocks.restore.mockResolvedValue(undefined)

    await runRestoreSession({}, {})

    expect(mocks.restore).toHaveBeenCalledWith(undefined)
  })

  it("reopens multiple sessions in one call", async () => {
    mocks.restore.mockResolvedValue(undefined)

    const result = await runRestoreSession({ sessionIds: ["a", "b", "c"] }, {})

    expect(mocks.restore).toHaveBeenCalledTimes(3)
    expect(mocks.restore).toHaveBeenNthCalledWith(1, "a")
    expect(mocks.restore).toHaveBeenNthCalledWith(3, "c")
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain("3 session(s)")
  })

  it("reports partial failure without hiding the successes", async () => {
    mocks.restore
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("gone"))

    const result = await runRestoreSession({ sessionIds: ["a", "b"] }, {})

    expect(result.isError).toBeFalsy()
    expect(result.content).toContain("Reopened 1")
    expect(result.content).toContain("Could not reopen 1")
  })

  it("caps the number reopened at the configured limit", async () => {
    mocks.storageGet.mockResolvedValue(2)
    mocks.restore.mockResolvedValue(undefined)

    const result = await runRestoreSession(
      { sessionIds: ["a", "b", "c", "d"] },
      {}
    )

    expect(mocks.restore).toHaveBeenCalledTimes(2)
    expect(result.content).toContain("Reopened 2")
    expect(result.content).toContain("2 more not reopened")
    expect(result.content).toContain("limit is 2")
  })

  it("does not restore without permission", async () => {
    mocks.availability.mockResolvedValue("permission")

    const result = await runRestoreSession({ sessionId: "x" }, {})

    expect(result.isError).toBe(true)
    expect(mocks.restore).not.toHaveBeenCalled()
  })

  it("surfaces a restore failure as a tool error", async () => {
    mocks.restore.mockRejectedValue(new Error("boom"))

    const result = await runRestoreSession({ sessionId: "x" }, {})

    expect(result.isError).toBe(true)
    expect(result.content).toContain("Could not reopen 1")
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
