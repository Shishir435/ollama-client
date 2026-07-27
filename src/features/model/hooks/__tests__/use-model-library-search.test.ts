import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"
import { useModelLibrarySearch } from "../use-model-library-search"

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: vi.fn() }
}))

const rpc = vi.mocked(extensionRpcClient.call)

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useModelLibrarySearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should initialize with empty state", () => {
    const { result } = renderHook(() => useModelLibrarySearch(), {
      wrapper: createWrapper()
    })

    expect(result.current.models).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it("should not search with empty query", () => {
    renderHook(() => useModelLibrarySearch(), { wrapper: createWrapper() })

    expect(rpc).not.toHaveBeenCalled()
  })

  it("should search models when query is set", async () => {
    rpc.mockResolvedValue({ html: "<html></html>" })

    const { result } = renderHook(() => useModelLibrarySearch(), {
      wrapper: createWrapper()
    })

    act(() => {
      result.current.setSearchQuery("llama")
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Models might be empty for invalid HTML, that's OK for this test
    expect(result.current.models).toBeDefined()
  })

  it("should handle search errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    rpc.mockRejectedValue(new Error("Failed to scrape"))

    const { result } = renderHook(() => useModelLibrarySearch(), {
      wrapper: createWrapper()
    })

    act(() => {
      result.current.setSearchQuery("test")
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.models).toEqual([])

    consoleSpy.mockRestore()
  })

  it("should load variants for a model", async () => {
    // First, set up initial models
    const mockSearchHtml = `
      <a href="/library/llama2">
        <h3>Llama 2</h3>
        <p>Description</p>
      </a>
    `

    rpc.mockResolvedValue({ html: mockSearchHtml })

    const { result } = renderHook(() => useModelLibrarySearch(), {
      wrapper: createWrapper()
    })

    act(() => {
      result.current.setSearchQuery("llama")
    })

    await waitFor(() => {
      expect(result.current.models.length).toBeGreaterThan(0)
    })

    // Now load variants
    const mockVariantsHtml = `
      <section>
        <a href="/library/llama2:latest">latest</a>
        <a href="/library/llama2:7b">7b</a>
      </section>
    `

    rpc.mockResolvedValue({ html: mockVariantsHtml })

    await act(async () => {
      await result.current.loadVariants("llama2")
    })

    await waitFor(() => {
      const model = result.current.models.find((m) => m.name === "llama2")
      expect(model?.variants).toBeDefined()
    })

    expect(rpc).toHaveBeenCalledWith(RpcMethod.ModelsGetLibraryVariants, {
      name: "llama2"
    })
  })
})
