import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleScrapeModel } from "../handle-scrape-model"
import { safeSendResponse } from "@/background/lib/utils"

vi.mock("@/background/lib/utils", () => ({
  safeSendResponse: vi.fn()
}))

global.fetch = vi.fn()

describe("handleScrapeModel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should scrape model search results successfully", async () => {
    const mockHtml = "<html>Model search results</html>"
    vi.mocked(fetch).mockResolvedValue({
      text: vi.fn().mockResolvedValue(mockHtml)
    } as any)

    const sendResponse = vi.fn()
    await handleScrapeModel("llama", sendResponse)

    expect(fetch).toHaveBeenCalledWith(
      "https://ollama.com/search?q=llama"
    )
    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: true,
      html: mockHtml
    })
  })

  it("should encode query parameters", async () => {
    vi.mocked(fetch).mockResolvedValue({
      text: vi.fn().mockResolvedValue("<html></html>")
    } as any)

    const sendResponse = vi.fn()
    await handleScrapeModel("llama 2 chat", sendResponse)

    expect(fetch).toHaveBeenCalledWith(
      "https://ollama.com/search?q=llama%202%20chat"
    )
  })

  it("should handle fetch errors", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

    const sendResponse = vi.fn()
    await handleScrapeModel("llama", sendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: false,
      error: { status: 0, message: "Network error" }
    })
  })

  it("should handle text parsing errors", async () => {
    vi.mocked(fetch).mockResolvedValue({
      text: vi.fn().mockRejectedValue(new Error("Parse error"))
    } as any)

    const sendResponse = vi.fn()
    await handleScrapeModel("llama", sendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: false,
      error: { status: 0, message: "Parse error" }
    })
  })
})
