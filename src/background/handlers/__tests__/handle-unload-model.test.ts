import { describe, expect, it, vi, beforeEach } from "vitest"
import { handleUnloadModel } from "../handle-unload-model"
import { safeSendResponse } from "@/background/lib/utils"

// Mock dependencies
vi.mock("@/background/lib/utils", () => ({
  getBaseUrl: vi.fn().mockResolvedValue("http://localhost:11434"),
  safeSendResponse: vi.fn()
}))

global.fetch = vi.fn()

describe("Handle Unload Model", () => {
  const mockSendResponse = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should successfully unload a model", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ done_reason: "unload" })
    } as any)

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

  it("should handle API errors", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error"
    } as any)

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
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ done_reason: "stop" })
    } as any)

    await handleUnloadModel("llama2", mockSendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
      success: false,
      data: { done_reason: "stop" }
    })
  })
})
