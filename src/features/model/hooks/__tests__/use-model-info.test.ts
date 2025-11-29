import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useModelInfo } from "../use-model-info"
import { browser } from "@/lib/browser-api"

// Mock browser API
vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn()
    }
  }
}))

describe("useModelInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should initialize with null state", () => {
    const { result } = renderHook(() => useModelInfo(""))

    expect(result.current.modelInfo).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it("should fetch model info on mount", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: true,
      data: { details: { format: "gguf" } }
    })

    const { result } = renderHook(() => useModelInfo("llama2"))

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(result.current.modelInfo).toBeTruthy()
    expect(result.current.loading).toBe(false)
  })

  it("should handle errors", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: false
    })

    const { result } = renderHook(() => useModelInfo("llama2"))

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(result.current.error).toBe("Failed to fetch model info")
  })

  it("should refresh on demand", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: true,
      data: { details: { format: "gguf" } }
    })

    const { result } = renderHook(() => useModelInfo("llama2"))

    await act(async () => {
      await result.current.refresh()
    })

    expect(browser.runtime.sendMessage).toHaveBeenCalled()
  })
})
