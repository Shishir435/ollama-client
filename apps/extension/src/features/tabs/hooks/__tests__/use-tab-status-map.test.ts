import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useTabStatusMap } from "../use-tab-status-map"

// Mock useTabContents
vi.mock("@/features/tabs/hooks/use-tab-contents", () => ({
  useTabContents: vi.fn()
}))

import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"

describe("useTabStatusMap", () => {
  it("should return status map function", () => {
    vi.mocked(useTabContents).mockReturnValue({
      tabContents: {},
      loadingIds: {},
      errors: {}
    })

    const { result } = renderHook(() => useTabStatusMap())

    expect(typeof result.current).toBe("function")
  })

  it("should return loading status", () => {
    vi.mocked(useTabContents).mockReturnValue({
      tabContents: {},
      loadingIds: { 123: true },
      errors: {}
    })

    const { result } = renderHook(() => useTabStatusMap())
    const status = result.current("123")

    expect(status.loading).toBe(true)
  })

  it("should return error for tab", () => {
    vi.mocked(useTabContents).mockReturnValue({
      tabContents: {},
      loadingIds: {},
      errors: { 123: "Error message" }
    })

    const { result } = renderHook(() => useTabStatusMap())
    const status = result.current("123")

    expect(status.error).toBe("Error message")
  })

  it("should return data for tab", () => {
    const tabData = { title: "Test", html: "<p>content</p>" }
    vi.mocked(useTabContents).mockReturnValue({
      tabContents: { 123: tabData },
      loadingIds: {},
      errors: {}
    })

    const { result } = renderHook(() => useTabStatusMap())
    const status = result.current("123")

    expect(status.data).toEqual(tabData)
  })

  it("should return null for missing tab", () => {
    vi.mocked(useTabContents).mockReturnValue({
      tabContents: {},
      loadingIds: {},
      errors: {}
    })

    const { result } = renderHook(() => useTabStatusMap())
    const status = result.current("999")

    expect(status.data).toBeNull()
    expect(status.error).toBeNull()
  })
})
