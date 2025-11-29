import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useDebouncedFormUpdate, useSyncFormWithConfig } from "../use-form-storage-sync"

describe("useDebouncedFormUpdate", () => {
  it("should not call updateConfig if value hasn't changed", () => {
    const updateConfig = vi.fn()

    renderHook(() =>
      useDebouncedFormUpdate("model" as any, "llama2", "llama2", updateConfig)
    )

    expect(updateConfig).not.toHaveBeenCalled()
  })

  it("should call updateConfig when value changes", () => {
    const updateConfig = vi.fn()

    renderHook(() =>
      useDebouncedFormUpdate("model" as any, "llama3", "llama2", updateConfig)
    )

    expect(updateConfig).toHaveBeenCalledWith({ model: "llama3" })
  })

  it("should respect validation", () => {
    const updateConfig = vi.fn()
    const validation = vi.fn().mockReturnValue(false)

    renderHook(() =>
      useDebouncedFormUpdate("temperature" as any, -1, 0.7, updateConfig, validation)
    )

    expect(validation).toHaveBeenCalledWith(-1)
    expect(updateConfig).not.toHaveBeenCalled()
  })
})

describe("useSyncFormWithConfig", () => {
  it("should reset form with config values", () => {
    const reset = vi.fn()
    const config = {
      system: "Test",
      temperature: 0.7,
      top_k: 40,
      top_p: 0.9,
      min_p: 0.05,
      seed: undefined,
      num_ctx: 2048,
      num_predict: -1,
      repeat_penalty: 1.1,
      repeat_last_n: 64
    } as any

    renderHook(() =>
      useSyncFormWithConfig(config, reset, "llama2")
    )

    expect(reset).toHaveBeenCalledWith(expect.objectContaining({
      system: "Test",
      temperature: 0.7
    }))
  })
})
