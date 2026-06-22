import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getTabGroupsAvailability,
  listAvailableBrowserTabGroups,
  requestTabGroupsAccess
} from "@/lib/browser-tab-groups"
import { useTabGroups } from "../use-tab-groups"

vi.mock("@/lib/browser-tab-groups", () => ({
  getTabGroupsAvailability: vi.fn(),
  listAvailableBrowserTabGroups: vi.fn(),
  requestTabGroupsAccess: vi.fn()
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn()
  }
}))

describe("useTabGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTabGroupsAvailability).mockResolvedValue("available")
    vi.mocked(listAvailableBrowserTabGroups).mockResolvedValue([])
    vi.mocked(requestTabGroupsAccess).mockResolvedValue(true)
  })

  it("does not fetch groups when disabled", () => {
    renderHook(() => useTabGroups(false))

    expect(getTabGroupsAvailability).not.toHaveBeenCalled()
    expect(listAvailableBrowserTabGroups).not.toHaveBeenCalled()
  })

  it("loads available tab groups", async () => {
    vi.mocked(listAvailableBrowserTabGroups).mockResolvedValue([
      {
        id: 1,
        title: "Research",
        tabs: [],
        skipped: 0
      }
    ])

    const { result } = renderHook(() => useTabGroups(true))

    await waitFor(() => expect(result.current.groups).toHaveLength(1))
    expect(result.current.availability).toBe("available")
  })

  it("rechecks availability and clears stale groups when group fetch fails", async () => {
    vi.mocked(getTabGroupsAvailability)
      .mockResolvedValueOnce("available")
      .mockResolvedValueOnce("permission")
    vi.mocked(listAvailableBrowserTabGroups).mockRejectedValue(
      new Error("permission revoked")
    )

    const { result } = renderHook(() => useTabGroups(true))

    await waitFor(() => expect(result.current.availability).toBe("permission"))
    expect(result.current.groups).toEqual([])
  })

  it("clears groups when fetch and recovery availability check both fail", async () => {
    vi.mocked(getTabGroupsAvailability)
      .mockResolvedValueOnce("available")
      .mockRejectedValueOnce(new Error("permissions unavailable"))
    vi.mocked(listAvailableBrowserTabGroups).mockRejectedValue(
      new Error("permission revoked")
    )

    const { result } = renderHook(() => useTabGroups(true))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.availability).toBe("available")
    expect(result.current.groups).toEqual([])
  })
})
