import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
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
      loading: false,
      errors: {}
    })

    const { result } = renderHook(() => useTabStatusMap())

    expect(typeof result.current).toBe("function")
  })

  it("should return loading status", () => {
    vi.mocked(useTabContents).mockReturnValue({
      tabContents: {},
      loading: true,
      errors: {}
    })

    const { result } = renderHook(() => useTabStatusMap())
    const status = result.current("123")

    expect(status.loading).toBe(true)
  })

  it("should return error for tab", () => {
    vi.mocked(useTabContents).mockReturnValue({
      tabContents: {},
      loading: false,
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
      loading: false,
      errors: {}
    })

    const { result } = renderHook(() => useTabStatusMap())
    const status = result.current("123")

    expect(status.data).toEqual(tabData)
  })

  it("should return null for missing tab", () => {
    vi.mocked(useTabContents).mockReturnValue({
      tabContents: {},
      loading: false,
      errors: {}
    })

    const { result } = renderHook(() => useTabStatusMap())
    const status = result.current("999")

    expect(status.data).toBeNull()
    expect(status.error).toBeNull()
  })
})
