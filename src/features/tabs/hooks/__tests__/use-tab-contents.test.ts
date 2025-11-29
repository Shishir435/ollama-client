import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useTabContents } from "../use-tab-contents"

// Mock dependencies
vi.mock("@/features/tabs/hooks/use-open-tab", () => ({
  useOpenTabs: vi.fn()
}))

vi.mock("@/features/tabs/stores/selected-tabs-store", () => ({
  useSelectedTabs: vi.fn()
}))

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: {
      sendMessage: vi.fn()
    }
  }
}))

import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useStorage } from "@plasmohq/storage/hook"
import { browser } from "@/lib/browser-api"

describe("useTabContents", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mocks
    vi.mocked(useOpenTabs).mockReturnValue({
      tabs: [],
      refreshTabs: vi.fn()
    })

    vi.mocked(useSelectedTabs).mockReturnValue({
      selectedTabIds: [],
      setSelectedTabIds: vi.fn(),
      errors: {},
      setErrors: vi.fn()
    })

    vi.mocked(useStorage).mockReturnValue([false, vi.fn(), {
      setRenderValue: vi.fn(),
      setStoreValue: vi.fn(),
      remove: vi.fn(),
      isLoading: false
    }])
  })

  it("should initialize with empty state", () => {
    const { result } = renderHook(() => useTabContents())

    expect(result.current.tabContents).toEqual({})
    expect(result.current.loading).toBe(false)
  })

  it("should not fetch when no tabs are selected", () => {
    renderHook(() => useTabContents())

    expect(browser.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it("should fetch tab contents when tabs are selected", async () => {
    const setErrors = vi.fn()
    
    vi.mocked(useSelectedTabs).mockReturnValue({
      selectedTabIds: ["123"],
      setSelectedTabIds: vi.fn(),
      errors: {},
      setErrors
    })

    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({
      html: "<p>Content</p>",
      title: "Test Page"
    })

    const { result } = renderHook(() => useTabContents())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.tabContents[123]).toEqual({
      html: "<p>Content</p>",
      title: "Test Page"
    })
  })

  it("should handle fetch errors", async () => {
    const setErrors = vi.fn()
    
    vi.mocked(useSelectedTabs).mockReturnValue({
      selectedTabIds: ["456"],
      setSelectedTabIds: vi.fn(),
      errors: {},
      setErrors
    })

    vi.mocked(browser.tabs.sendMessage).mockRejectedValue(new Error("Fetch failed"))

    renderHook(() => useTabContents())

    await waitFor(() => {
      expect(setErrors).toHaveBeenCalledWith(expect.objectContaining({
        456: expect.any(String)
      }))
    })
  })

  it("should get tab title from open tabs", async () => {
    vi.mocked(useOpenTabs).mockReturnValue({
      tabs: [{ id: 789, title: "Open Tab Title" } as any],
      refreshTabs: vi.fn()
    })

    vi.mocked(useSelectedTabs).mockReturnValue({
      selectedTabIds: ["789"],
      setSelectedTabIds: vi.fn(),
      errors: {},
      setErrors: vi.fn()
    })

    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({
      html: "<p>Content</p>"
      // No title in response
    })

    const { result } = renderHook(() => useTabContents())

    await waitFor(() => {
      expect(result.current.tabContents[789]?.title).toBe("Open Tab Title")
    })
  })
})
