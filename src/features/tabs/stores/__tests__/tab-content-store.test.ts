import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useTabContent, useTabContentStore } from "../tab-content-store"

// Mock dependencies
vi.mock("@/features/tabs/hooks/use-tab-contents", () => ({
  useTabContents: vi.fn(() => ({
    tabContents: {},
    loadingIds: {},
    errors: {}
  }))
}))

vi.mock("@/features/tabs/stores/selected-tabs-store", () => ({
  useSelectedTabs: vi.fn(() => ({
    selectedTabIds: [],
    errors: {}
  }))
}))

describe("useTabContentStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    useTabContentStore.setState({ builtContent: "", documents: [] })
    vi.clearAllMocks()
  })

  it("should initialize with empty content", () => {
    const state = useTabContentStore.getState()
    expect(state.builtContent).toBe("")
    expect(state.documents).toEqual([])
  })

  it("should set built content", () => {
    const { setBuiltContent } = useTabContentStore.getState()
    setBuiltContent("Test content")

    expect(useTabContentStore.getState().builtContent).toBe("Test content")
  })

  it("should build content from selected tabs", async () => {
    const { useTabContents } = await import(
      "@/features/tabs/hooks/use-tab-contents"
    )
    const { useSelectedTabs } = await import(
      "@/features/tabs/stores/selected-tabs-store"
    )

    vi.mocked(useSelectedTabs).mockReturnValue({
      selectedTabIds: ["1"],
      errors: {},
      setSelectedTabIds: vi.fn(),
      setErrors: vi.fn()
    })

    vi.mocked(useTabContents).mockReturnValue({
      tabContents: {
        1: { title: "Test Page", html: "<p>Content</p>" }
      },
      loadingIds: {},
      errors: {}
    })

    const { result } = renderHook(() => useTabContent())

    expect(result.current.builtContent).toContain("Test Page")
    expect(result.current.builtContent).toContain("<p>Content</p>")
    expect(result.current.documents).toEqual([
      {
        id: "1",
        title: "Test Page",
        content: "<p>Content</p>"
      }
    ])
  })

  it("should handle errors in tab content", async () => {
    const { useTabContents } = await import(
      "@/features/tabs/hooks/use-tab-contents"
    )
    const { useSelectedTabs } = await import(
      "@/features/tabs/stores/selected-tabs-store"
    )

    vi.mocked(useSelectedTabs).mockReturnValue({
      selectedTabIds: ["1"],
      errors: { 1: "Failed to load" },
      setSelectedTabIds: vi.fn(),
      setErrors: vi.fn()
    })

    vi.mocked(useTabContents).mockReturnValue({
      tabContents: {
        1: { title: "Error Page", html: "" }
      },
      loadingIds: {},
      errors: {}
    })

    const { result } = renderHook(() => useTabContent())

    expect(result.current.builtContent).toContain("❌ Error: Failed to load")
    expect(result.current.documents).toEqual([])
  })

  it("should handle missing tab content", async () => {
    const { useTabContents } = await import(
      "@/features/tabs/hooks/use-tab-contents"
    )
    const { useSelectedTabs } = await import(
      "@/features/tabs/stores/selected-tabs-store"
    )

    vi.mocked(useSelectedTabs).mockReturnValue({
      selectedTabIds: ["1"],
      errors: {},
      setSelectedTabIds: vi.fn(),
      setErrors: vi.fn()
    })

    vi.mocked(useTabContents).mockReturnValue({
      tabContents: {},
      loadingIds: {},
      errors: {}
    })

    const { result } = renderHook(() => useTabContent())

    expect(result.current.builtContent).toContain("(No content)")
    expect(result.current.documents).toEqual([])
  })
})
