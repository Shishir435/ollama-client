import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleGetOllamaVersion } from "../handle-get-ollama-version"
import { getBaseUrl, safeSendResponse } from "@/background/lib/utils"

vi.mock("@/background/lib/utils", () => ({
  getBaseUrl: vi.fn(),
  safeSendResponse: vi.fn()
}))

global.fetch = vi.fn()

describe("handleGetOllamaVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBaseUrl).mockResolvedValue("http://localhost:11434")
  })

  it("should get Ollama version successfully", async () => {
    const mockData = { version: "0.1.17" }
    
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockData)
    } as any)

    const sendResponse = vi.fn()
    await handleGetOllamaVersion(sendResponse)

    expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/version")
    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: true,
      data: mockData
    })
  })

  it("should use custom base URL", async () => {
    vi.mocked(getBaseUrl).mockResolvedValue("http://custom:8080")
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ version: "0.1.17" })
    } as any)

    const sendResponse = vi.fn()
    await handleGetOllamaVersion(sendResponse)

    expect(fetch).toHaveBeenCalledWith("http://custom:8080/api/version")
  })

  it("should handle API errors", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found"
    } as any)

    const sendResponse = vi.fn()
    await handleGetOllamaVersion(sendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: false,
      error: { status: 404, message: "Not Found" }
    })
  })

  it("should handle network errors", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Connection refused"))

    const sendResponse = vi.fn()
    await handleGetOllamaVersion(sendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: false,
      error: { status: 0, message: "Connection refused" }
    })
  })
})
