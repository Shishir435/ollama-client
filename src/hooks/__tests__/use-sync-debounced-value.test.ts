import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useSyncDebouncedValue } from "../use-sync-debounced-value"

describe("useSyncDebouncedValue", () => {
  it("should not call updateConfig if values are the same", () => {
    const updateConfig = vi.fn()
    
    renderHook(() =>
      useSyncDebouncedValue("model", "llama2", "llama2", updateConfig)
    )

    expect(updateConfig).not.toHaveBeenCalled()
  })

  it("should call updateConfig when debounced value changes", () => {
    const updateConfig = vi.fn()
    
    renderHook(() =>
      useSyncDebouncedValue("model", "llama3", "llama2", updateConfig)
    )

    expect(updateConfig).toHaveBeenCalledWith({ model: "llama3" })
  })

  it("should not call updateConfig if validation fails", () => {
    const updateConfig = vi.fn()
    const validation = vi.fn().mockReturnValue(false)
    
    renderHook(() =>
      useSyncDebouncedValue("model", "invalid", "llama2", updateConfig, validation)
    )

    expect(validation).toHaveBeenCalledWith("invalid")
    expect(updateConfig).not.toHaveBeenCalled()
  })

  it("should call updateConfig if validation passes", () => {
    const updateConfig = vi.fn()
    const validation = vi.fn().mockReturnValue(true)
    
    renderHook(() =>
      useSyncDebouncedValue("model", "llama3", "llama2", updateConfig, validation)
    )

    expect(validation).toHaveBeenCalledWith("llama3")
    expect(updateConfig).toHaveBeenCalledWith({ model: "llama3" })
  })
})
