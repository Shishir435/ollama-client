import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "@/lib/browser-api"
import { ProviderFactory } from "@/lib/providers/factory"
import { useModelInfo } from "../use-model-info"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn()
    }
  }
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn()
  }
}))

/** Mock the in-page provider used by the primary fetch path. */
const mockProvider = (
  getModelDetails: ((model: string) => Promise<unknown>) | undefined,
  id = "ollama"
) => {
  vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue({
    id,
    capabilities: { modelDetails: Boolean(getModelDetails) },
    getModelDetails
  } as never)
}

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

  it("should fetch model info in-page on mount", async () => {
    mockProvider(vi.fn().mockResolvedValue({ details: { format: "gguf" } }))

    const { result } = renderHook(() => useModelInfo("llama2"), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.modelInfo).toBeTruthy()
    // In-page path served it; no worker round-trip.
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it("should surface an error when both in-page and worker fail", async () => {
    mockProvider(vi.fn().mockRejectedValue(new Error("network down")))
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

  it("treats empty Ollama details as an error instead of hiding the card", async () => {
    // In-page reports details supported but returns null → fall back to worker,
    // which also returns null for a detail-capable provider → error.
    mockProvider(vi.fn().mockResolvedValue(null))
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: true,
      data: null,
      providerId: "ollama",
      supportsDetails: true
    })

    const { result } = renderHook(
      () => useModelInfo("qwen3.5:latest", "ollama"),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.error).toBe(
        "Provider returned no model info for qwen3.5:latest"
      )
    })
  })

  it("does not error on a null worker response with no provider hint", async () => {
    // Older worker: success + null data, but no providerId/supportsDetails, and
    // the client passed no providerId. We must NOT guess Ollama and reclassify
    // this as a failure — it's a benign no-details state.
    mockProvider(vi.fn().mockRejectedValue(new Error("blocked")))
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: true,
      data: null
    })

    const { result } = renderHook(() => useModelInfo("mystery-model"), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBeNull()
    expect(result.current.modelInfo).toBeNull()
  })

  it("does not call an inherited null detail method when unsupported", async () => {
    const getModelDetails = vi.fn().mockResolvedValue(null)
    vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue({
      id: "llama-cpp",
      capabilities: { modelDetails: false },
      getModelDetails
    } as never)

    const { result } = renderHook(
      () => useModelInfo("gemma.gguf", "llama-cpp"),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(getModelDetails).not.toHaveBeenCalled()
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it("falls back to the worker (structured payload preserves providerId) when in-page fetch throws", async () => {
    mockProvider(vi.fn().mockRejectedValue(new Error("blocked")))
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        success: true,
        data: {
          details: {
            parent_model: "",
            format: "gguf",
            family: "llama",
            families: ["llama"],
            parameter_size: "8B",
            quantization_level: "Q4_0"
          }
        }
      })

    const { result } = renderHook(
      () => useModelInfo("dolphin-llama3:latest", "ollama"),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.modelInfo).toBeTruthy())

    expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: "show-model-details",
      payload: { model: "dolphin-llama3:latest", providerId: "ollama" }
    })
  })

  it("should refresh on demand", async () => {
    mockProvider(vi.fn().mockResolvedValue({ details: { format: "gguf" } }))

    const { result } = renderHook(() => useModelInfo("llama2"), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.refresh()
    })

    expect(ProviderFactory.getProviderForModel).toHaveBeenCalled()
  })
})
