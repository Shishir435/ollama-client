import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleScrapeModelVariants } from "../handle-scrape-model-variants"
import { safeSendResponse } from "@/background/lib/utils"

vi.mock("@/background/lib/utils", () => ({
  safeSendResponse: vi.fn()
}))

global.fetch = vi.fn()

describe("handleScrapeModelVariants", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should scrape model variants successfully", async () => {
    const mockHtml = "<html>Model variants page</html>"
    vi.mocked(fetch).mockResolvedValue({
      text: vi.fn().mockResolvedValue(mockHtml)
    } as any)

    const sendResponse = vi.fn()
    await handleScrapeModelVariants("llama2", sendResponse)

    expect(fetch).toHaveBeenCalledWith(
      "https://ollama.com/library/llama2"
    )
    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: true,
      html: mockHtml
    })
  })

  it("should encode model name", async () => {
    vi.mocked(fetch).mockResolvedValue({
      text: vi.fn().mockResolvedValue("<html></html>")
    } as any)

    const sendResponse = vi.fn()
    await handleScrapeModelVariants("llama 2", sendResponse)

    expect(fetch).toHaveBeenCalledWith(
      "https://ollama.com/library/llama%202"
    )
  })

  it("should handle fetch errors", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

    const sendResponse = vi.fn()
    await handleScrapeModelVariants("llama2", sendResponse)

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
    await handleScrapeModelVariants("llama2", sendResponse)

    expect(safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: false,
      error: { status: 0, message: "Parse error" }
    })
  })
})
