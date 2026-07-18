import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { browser } from "@/lib/browser-api"
import { ProviderFactory } from "@/lib/providers/factory"
import { queryKeys } from "@/lib/query-keys"
import { useModelCapabilityTags } from "../use-model-capability-tags"
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

describe("shared model-info query contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not cache a fetch failure as successful null model info", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    // In-page fetch throws → falls back to the worker, which also fails. The
    // query must land in `error`, never cache a transport failure as `null`.
    vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue({
      id: "ollama",
      capabilities: { modelDetails: true },
      getModelDetails: vi.fn().mockRejectedValue(new Error("network down"))
    } as never)
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: false,
      error: { status: 0, message: "temporary failure" }
    })

    const capabilityResult = renderHook(
      () =>
        useModelCapabilityTags(
          [
            {
              name: "qwen3.5:latest",
              model: "qwen3.5:latest",
              providerId: "ollama",
              modified_at: "",
              size: 0,
              digest: "",
              details: {
                parent_model: "",
                format: "gguf",
                family: "qwen35",
                families: ["qwen35"],
                parameter_size: "9.7B",
                quantization_level: "Q4_K_M"
              }
            }
          ],
          true
        ),
      { wrapper }
    )
    const key = [...queryKeys.model.info("qwen3.5:latest"), "ollama"]
    await waitFor(() => {
      expect(client.getQueryState(key)?.status).toBe("error")
    })
    capabilityResult.unmount()
  })

  it("serves model info from the in-page provider without a worker round-trip", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue({
      id: "ollama",
      capabilities: { modelDetails: true },
      getModelDetails: vi.fn().mockResolvedValue({
        license: "big license text",
        modelfile: "FROM ...",
        capabilities: ["completion", "vision"],
        model_info: { "qwen35.context_length": 262144 }
      })
    } as never)

    const modelInfoResult = renderHook(
      () => useModelInfo("qwen3.5:latest", "ollama"),
      { wrapper }
    )
    await waitFor(() => {
      expect(modelInfoResult.result.current.modelInfo).toEqual(
        expect.objectContaining({
          capabilities: ["completion", "vision"]
        })
      )
    })
    // In-page path served it; the worker was never contacted, and the large
    // license/modelfile fields were stripped before caching.
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled()
    expect(modelInfoResult.result.current.modelInfo).not.toHaveProperty(
      "license"
    )
  })

  it("treats null data as a non-error when the provider can't self-report", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    // A detail-less provider (e.g. OpenAI-compatible) must not be mistaken for a
    // transport failure.
    vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue({
      id: "openai-compatible",
      capabilities: { modelDetails: false },
      getModelDetails: undefined
    } as never)

    const modelInfoResult = renderHook(() => useModelInfo("gpt-4"), { wrapper })

    await waitFor(() => {
      expect(modelInfoResult.result.current.loading).toBe(false)
    })
    expect(modelInfoResult.result.current.error).toBeNull()
    expect(modelInfoResult.result.current.modelInfo).toBeNull()
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled()
  })
})
