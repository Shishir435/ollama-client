import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useOpenTabs } from "../use-open-tab"
import { browser } from "@/lib/browser-api"

// Mock browser API
vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn()
    }
  }
}))

describe("useOpenTabs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should initialize with empty tabs", () => {
    const { result } = renderHook(() => useOpenTabs(false))

    expect(result.current.tabs).toEqual([])
  })

  it("should not fetch tabs when disabled", async () => {
    renderHook(() => useOpenTabs(false))

    expect(browser.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it("should fetch tabs when enabled", async () => {
    const mockTabs = [
      { id: 1, title: "Tab 1", url: "https://example.com" },
      { id: 2, title: "Tab 2", url: "https://test.com" }
    ]

    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      tabs: mockTabs
    })

    const { result } = renderHook(() => useOpenTabs(true))

    await waitFor(() => {
      expect(result.current.tabs).toEqual(mockTabs)
    })
  })

  it("should handle fetch errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(browser.runtime.sendMessage).mockRejectedValue(new Error("Failed"))

    const { result } = renderHook(() => useOpenTabs(true))

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled()
    })

    expect(result.current.tabs).toEqual([])
    
    consoleSpy.mockRestore()
  })

  it("should provide refreshTabs function", async () => {
    const mockTabs = [{ id: 1, title: "Tab 1" }]
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ tabs: mockTabs })

    const { result } = renderHook(() => useOpenTabs(true))

    expect(result.current.refreshTabs).toBeDefined()
    
    await result.current.refreshTabs()

    await waitFor(() => {
      expect(result.current.tabs).toEqual(mockTabs)
    })
  })
})
