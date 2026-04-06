import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useDebouncedFormField } from "../use-debounced-form-field"

// Mock useDebounce
vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: vi.fn((value) => value)
}))

describe("useDebouncedFormField", () => {
  it("should return debounced value from watch", () => {
    const mockWatch = vi.fn().mockReturnValue("test-value") as any

    const { result } = renderHook(() =>
      useDebouncedFormField(mockWatch, "temperature", 500)
    )

    expect(mockWatch).toHaveBeenCalledWith("temperature")
    expect(result.current).toBe("test-value")
  })

  it("should use default delay", () => {
    const mockWatch = vi.fn().mockReturnValue(42) as any

    const { result } = renderHook(() =>
      useDebouncedFormField(mockWatch, "temperature", undefined)
    )

    expect(result.current).toBe(42)
  })
})
