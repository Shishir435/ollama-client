import { beforeEach, describe, expect, it, vi } from "vitest"
import { safeSendResponse } from "@/background/lib/utils"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderId } from "@/lib/providers/types"
import { handleUnloadModel } from "../handle-unload-model"
import { createMockResponse } from "./test-utils"

// Mock dependencies
vi.mock("@/background/lib/utils", () => ({
  getBaseUrl: vi.fn().mockResolvedValue("http://localhost:11434"),
  safeSendResponse: vi.fn()
}))
vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn()
  }
}))

global.fetch = vi.fn()

describe("Handle Unload Model", () => {
  const mockSendResponse = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue({
      id: "ollama",
      config: {
        baseUrl: "http://localhost:11434"
      }
    } as any)
  })

  it("should successfully unload a model", async () => {
    vi.mocked(fetch).mockResolvedValue(
      createMockResponse({ done_reason: "unload" })
    )

    await handleUnloadModel("llama2", mockSendResponse)

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "llama2",
          messages: [],
          keep_alive: 0
        })
      })
    )

    expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
      success: true,
      data: { done_reason: "unload" }
    })
  })

  it("uses the resolved LM Studio URL even without a providerId payload", async () => {
    vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue({
      id: ProviderId.LM_STUDIO,
      config: {
        id: ProviderId.LM_STUDIO,
        type: "openai",
        name: "LM Studio",
        enabled: true,
        baseUrl: "http://lm-box:1234/v1"
      }
    } as any)
    vi.mocked(fetch).mockResolvedValue(createMockResponse({}))

    await handleUnloadModel("shared-model", mockSendResponse)

    expect(fetch).toHaveBeenCalledWith(
      "http://lm-box:1234/api/v1/models/unload",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "shared-model" })
      })
    )
  })

  it("should handle API errors", async () => {
    vi.mocked(fetch).mockResolvedValue(
      createMockResponse(null, {
        ok: false,
        status: 500,
        statusText: "Internal Server Error"
      })
    )

    await handleUnloadModel("llama2", mockSendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
      success: false,
      error: { status: 500, message: "Internal Server Error" }
    })
  })

  it("should handle network errors", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network Error"))

    await handleUnloadModel("llama2", mockSendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
      success: false,
      error: { status: 0, message: "Network Error" }
    })
  })

  it("should handle non-unload done reasons", async () => {
    vi.mocked(fetch).mockResolvedValue(
      createMockResponse({ done_reason: "stop" })
    )

    await handleUnloadModel("llama2", mockSendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
      success: false,
      data: { done_reason: "stop" }
    })
  })
})
