import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "@/lib/browser-api"
import { useModelInfo } from "../use-model-info"

// Mock browser API
vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn()
    }
  }
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useModelInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should initialize with null state", () => {
    const { result } = renderHook(() => useModelInfo(""), {
      wrapper: createWrapper()
    })

    expect(result.current.modelInfo).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it("should fetch model info on mount", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: true,
      data: { details: { format: "gguf" } }
    })

    const { result } = renderHook(() => useModelInfo("llama2"), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.modelInfo).toBeTruthy()
  })

  it("should handle errors", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: false
    })

    const { result } = renderHook(() => useModelInfo("llama2"), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.error).toBe("Failed to fetch model info")
    })
  })

  it("should refresh on demand", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: true,
      data: { details: { format: "gguf" } }
    })

    const { result } = renderHook(() => useModelInfo("llama2"), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.refresh()
    })

    expect(browser.runtime.sendMessage).toHaveBeenCalled()
  })
})
