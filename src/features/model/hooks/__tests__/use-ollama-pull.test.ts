import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useOllamaPull } from "../use-ollama-pull"
import { browser } from "@/lib/browser-api"

// Mock browser API
vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      connect: vi.fn()
    }
  }
}))

describe("useOllamaPull", () => {
  let mockPort: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockPort = {
      postMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn()
      },
      disconnect: vi.fn()
    }

    vi.mocked(browser.runtime.connect).mockReturnValue(mockPort)
  })

  it("should initialize with null state", () => {
    const { result } = renderHook(() => useOllamaPull())

    expect(result.current.pullingModel).toBeNull()
    expect(result.current.progress).toBeNull()
  })

  it("should start pulling a model", () => {
    const { result } = renderHook(() => useOllamaPull())

    act(() => {
      result.current.pullModel("llama2")
    })

    expect(result.current.pullingModel).toBe("llama2")
    expect(result.current.progress).toBe("Starting...")
    expect(mockPort.postMessage).toHaveBeenCalledWith({ payload: "llama2" })
  })

  it("should handle progress updates", () => {
    const { result } = renderHook(() => useOllamaPull())

    act(() => {
      result.current.pullModel("llama2")
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({ status: "Downloading..." })
    })

    expect(result.current.progress).toBe("Downloading...")
  })

  it("should handle pull completion", () => {
    const { result } = renderHook(() => useOllamaPull())

    act(() => {
      result.current.pullModel("llama2")
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({ done: true })
    })

    expect(result.current.progress).toBe("✅ Success")
    expect(result.current.pullingModel).toBeNull()
    expect(mockPort.disconnect).toHaveBeenCalled()
  })

  it("should handle pull errors", () => {
    const { result } = renderHook(() => useOllamaPull())

    act(() => {
      result.current.pullModel("llama2")
    })

    const listener = mockPort.onMessage.addListener.mock.calls[0][0]

    act(() => {
      listener({ error: "Network error" })
    })

    expect(result.current.progress).toContain("❌ Failed")
    expect(result.current.pullingModel).toBeNull()
  })

  it("should cancel pull", () => {
    const { result } = renderHook(() => useOllamaPull())

    act(() => {
      result.current.pullModel("llama2")
    })

    act(() => {
      result.current.cancelPull()
    })

    expect(result.current.progress).toBe("❌ Cancelled")
    expect(result.current.pullingModel).toBeNull()
    expect(mockPort.disconnect).toHaveBeenCalled()
  })
})
