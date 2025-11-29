import { renderHook, waitFor, act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDebounce } from "../use-debounce"

describe("useDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should return initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("initial", 500))
    
    expect(result.current).toBe("initial")
  })

  it("should debounce value changes", async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: "initial", delay: 500 } }
    )

    expect(result.current).toBe("initial")

    // Update value
    rerender({ value: "updated", delay: 500 })
    
    // Value should not change immediately
    expect(result.current).toBe("initial")

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Value should now be updated
    expect(result.current).toBe("updated")
  })

  it("should reset timer on rapid value changes", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: "first" } }
    )

    // Rapid changes
    rerender({ value: "second" })
    act(() => {
      vi.advanceTimersByTime(250)
    })
    
    rerender({ value: "third" })
    act(() => {
      vi.advanceTimersByTime(250)
    })

    // Should still be "first" because timer keeps resetting
    expect(result.current).toBe("first")

    // Only after full delay from last change
    act(() => {
      vi.advanceTimersByTime(250)
    })
    
    expect(result.current).toBe("third")
  })

  it("should handle delay changes", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: "test", delay: 500 } }
    )

    rerender({ value: "new", delay: 500 })
    
    act(() => {
      vi.advanceTimersByTime(400)
    })
    
    // Change delay before original timeout
    rerender({ value: "new", delay: 1000 })
    
    act(() => {
      vi.advanceTimersByTime(600)
    })
    
    // Should not update yet with new delay
    expect(result.current).toBe("test")
    
    act(() => {
      vi.advanceTimersByTime(400)
    })
    
    expect(result.current).toBe("new")
  })

  it("should work with different data types", () => {
    // Number
    const { result: numberResult } = renderHook(() => useDebounce(42, 100))
    expect(numberResult.current).toBe(42)

    // Object
    const obj = { key: "value" }
    const { result: objectResult } = renderHook(() => useDebounce(obj, 100))
    expect(objectResult.current).toBe(obj)

    // Array
    const arr = [1, 2, 3]
    const { result: arrayResult } = renderHook(() => useDebounce(arr, 100))
    expect(arrayResult.current).toBe(arr)

    // Boolean
    const { result: boolResult } = renderHook(() => useDebounce(true, 100))
    expect(boolResult.current).toBe(true)
  })

  it("should cleanup timeout on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")
    
    const { unmount } = renderHook(() => useDebounce("test", 500))
    
    unmount()
    
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })

  it("should handle zero delay", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 0),
      { initialProps: { value: "initial" } }
    )

    rerender({ value: "updated" })
    
    act(() => {
      vi.advanceTimersByTime(0)
    })
    
    expect(result.current).toBe("updated")
  })

  it("should handle very long delays", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 10000),
      { initialProps: { value: "initial" } }
    )

    rerender({ value: "updated" })
    
    act(() => {
      vi.advanceTimersByTime(9999)
    })
    
    expect(result.current).toBe("initial")
    
    act(() => {
      vi.advanceTimersByTime(1)
    })
    
    expect(result.current).toBe("updated")
  })
})
