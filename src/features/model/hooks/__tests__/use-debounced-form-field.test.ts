import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useDebouncedFormField } from "../use-debounced-form-field"

// Mock useDebounce
vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: vi.fn((value) => value)
}))

describe("useDebouncedFormField", () => {
  it("should return debounced value from watch", () => {
    const mockWatch = vi.fn().mockReturnValue("test-value")
    
    const { result } = renderHook(() =>
      useDebouncedFormField(mockWatch, "model", 500)
    )

    expect(mockWatch).toHaveBeenCalledWith("model")
    expect(result.current).toBe("test-value")
  })

  it("should use default delay", () => {
    const mockWatch = vi.fn().mockReturnValue(42)
    
    const { result } = renderHook(() =>
      useDebouncedFormField(mockWatch, "temperature", undefined)
    )

    expect(result.current).toBe(42)
  })
})
