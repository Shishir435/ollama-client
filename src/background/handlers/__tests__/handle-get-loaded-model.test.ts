import { beforeEach, describe, expect, it, vi } from "vitest"
import { getBaseUrl, safeSendResponse } from "@/background/lib/utils"
import { ProviderFactory } from "@/lib/providers/factory"
import { handleGetLoadedModels } from "../handle-get-loaded-model"

vi.mock("@/background/lib/utils", () => ({
  getBaseUrl: vi.fn(),
  safeSendResponse: vi.fn()
}))
vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProvider: vi.fn()
  }
}))

global.fetch = vi.fn()

describe("handleGetLoadedModels", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBaseUrl).mockResolvedValue("http://localhost:11434")
    vi.mocked(ProviderFactory.getProvider).mockResolvedValue({
      id: "ollama",
      config: {
        baseUrl: "http://localhost:11434"
      }
    } as any)
  })

  it("should get loaded models successfully", async () => {
    const mockData = {
      models: [{ name: "llama2:latest", size: 3825819519 }]
    }

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockData)
    } as any)

    const sendResponse = vi.fn()
    await handleGetLoadedModels(undefined, sendResponse)

    expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/ps")
    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: true,
      data: mockData
    })
  })

  it("should use custom base URL", async () => {
    vi.mocked(getBaseUrl).mockResolvedValue("http://custom:8080")
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({})
    } as any)

    const sendResponse = vi.fn()
    await handleGetLoadedModels(undefined, sendResponse)

    expect(fetch).toHaveBeenCalledWith("http://custom:8080/api/ps")
  })

  it("should handle API errors", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error"
    } as any)

    const sendResponse = vi.fn()
    await handleGetLoadedModels(undefined, sendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: false,
      error: { status: 500, message: "Internal Server Error" }
    })
  })

  it("should handle network errors", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

    const sendResponse = vi.fn()
    await handleGetLoadedModels(undefined, sendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: false,
      error: { status: 0, message: "Network error" }
    })
  })

  it("should handle JSON parsing errors", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new Error("Invalid JSON"))
    } as any)

    const sendResponse = vi.fn()
    await handleGetLoadedModels(undefined, sendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: false,
      error: { status: 0, message: "Invalid JSON" }
    })
  })
})
