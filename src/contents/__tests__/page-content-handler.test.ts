import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  extractContentWithLoading: vi.fn(),
  extractReadableContent: vi.fn(),
  getTranscript: vi.fn(),
  getYouTubeVideoId: vi.fn(),
  isExcludedUrl: vi.fn(),
  isUdemyLecturePage: vi.fn(),
  isYouTubeVideoPage: vi.fn(),
  readSetting: vi.fn(),
  resolveActiveConfig: vi.fn(),
  resolvePageTitle: vi.fn()
}))

vi.mock("@/lib/content-extractor", () => ({
  extractContentWithLoading: mocks.extractContentWithLoading
}))

vi.mock("@/lib/storage/setting-access", () => ({
  readSetting: mocks.readSetting
}))

vi.mock("@/lib/transcript-extractor", () => ({
  getTranscript: mocks.getTranscript
}))

vi.mock("@/lib/youtube-url", () => ({
  getYouTubeVideoId: mocks.getYouTubeVideoId
}))

vi.mock("../content-config", () => ({
  resolveActiveConfig: mocks.resolveActiveConfig
}))

vi.mock("../content-extraction", () => ({
  extractReadableContent: mocks.extractReadableContent,
  resolvePageTitle: mocks.resolvePageTitle
}))

vi.mock("../page-platforms", () => ({
  isUdemyLecturePage: mocks.isUdemyLecturePage,
  isYouTubeVideoPage: mocks.isYouTubeVideoPage
}))

vi.mock("../url-filter", () => ({
  isExcludedUrl: mocks.isExcludedUrl
}))

import { handleGetPageContent } from "../page-content-handler"

const extractionConfig = {
  contentScraper: "auto",
  enabled: true,
  maxWaitTime: 1000,
  scrollDepth: 0.8,
  scrollStrategy: "incremental"
}

beforeEach(() => {
  vi.clearAllMocks()
  document.head.innerHTML = ""
  document.body.innerHTML = ""
  document.title = "Page title"
  window.history.replaceState({}, "", "/article")
  mocks.readSetting.mockResolvedValue(true)
  mocks.isExcludedUrl.mockResolvedValue(false)
  mocks.isYouTubeVideoPage.mockReturnValue(false)
  mocks.isUdemyLecturePage.mockReturnValue(false)
  mocks.resolveActiveConfig.mockResolvedValue({
    effectiveConfig: extractionConfig,
    hasSiteOverride: false
  })
  mocks.extractContentWithLoading.mockResolvedValue({
    metrics: { duration: 12, scrollSteps: 2 }
  })
  mocks.extractReadableContent.mockReturnValue({
    pageTitle: "Extracted title",
    readableText: "Useful article text. ".repeat(8),
    selectedExtractor: "defuddle",
    selectedReason: "defuddle-markdown"
  })
  mocks.resolvePageTitle.mockReturnValue("Resolved title")
  mocks.getTranscript.mockResolvedValue(null)
  mocks.getYouTubeVideoId.mockReturnValue(null)
})

describe("handleGetPageContent", () => {
  it("fails closed before extraction when tab access is disabled", async () => {
    mocks.readSetting.mockResolvedValueOnce(false)
    const sendResponse = vi.fn()

    await handleGetPageContent(sendResponse)

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      html: "Tab access is disabled by the user.",
      title: "Page title"
    })
    expect(mocks.resolveActiveConfig).not.toHaveBeenCalled()
    expect(mocks.extractReadableContent).not.toHaveBeenCalled()
  })

  it("rejects an excluded URL before resolving extraction config", async () => {
    mocks.isExcludedUrl.mockResolvedValueOnce(true)
    const sendResponse = vi.fn()

    await handleGetPageContent(sendResponse)

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      html: "This page is excluded by your settings.",
      title: "Page title"
    })
    expect(mocks.resolveActiveConfig).not.toHaveBeenCalled()
  })

  it("returns canonical YouTube metadata and transcript without scraping the page", async () => {
    mocks.isYouTubeVideoPage.mockReturnValueOnce(true)
    mocks.getYouTubeVideoId.mockReturnValueOnce("video-123")
    mocks.getTranscript.mockResolvedValueOnce("First line\nSecond line")
    document.body.innerHTML = `
      <div id="channel-name"><a> Test Channel </a></div>
      <div id="top-level-buttons-computed">
        <button aria-label="1,234 likes"></button>
        <button aria-label="5 dislikes"></button>
      </div>
    `
    const sendResponse = vi.fn()

    await handleGetPageContent(sendResponse)

    expect(sendResponse).toHaveBeenCalledOnce()
    const response = sendResponse.mock.calls[0]?.[0] as {
      html: string
      title: string
    }
    expect(response.title).toBe("Resolved title")
    expect(response.html).toContain(
      "Video URL: https://www.youtube.com/watch?v=video-123"
    )
    expect(response.html).toContain("Channel: Test Channel")
    expect(response.html).toContain("Likes: 1,234 likes")
    expect(response.html).toContain("First line\nSecond line")
    expect(mocks.extractContentWithLoading).not.toHaveBeenCalled()
    expect(mocks.extractReadableContent).not.toHaveBeenCalled()
  })

  it("falls back to readable extraction when enhanced extraction fails", async () => {
    mocks.extractContentWithLoading.mockRejectedValueOnce(
      new Error("provider unavailable")
    )
    mocks.getTranscript.mockResolvedValueOnce("Transcript text")
    const sendResponse = vi.fn()

    await handleGetPageContent(sendResponse)

    expect(mocks.extractReadableContent).toHaveBeenCalledWith(document, "auto")
    expect(sendResponse).toHaveBeenCalledOnce()
    const response = sendResponse.mock.calls[0]?.[0] as {
      extractionDebug: Record<string, unknown>
      html: string
      success: boolean
      title: string
    }
    expect(response).toMatchObject({
      success: true,
      title: "Resolved title"
    })
    expect(response.html).toContain("Transcript text")
    expect(response.html).toContain("Useful article text")
    expect(response.extractionDebug).toMatchObject({
      hasTranscript: true,
      selectedExtractor: "defuddle",
      selectedReason: "defuddle-markdown"
    })
  })

  it("rejects content too short to be meaningful", async () => {
    mocks.extractReadableContent.mockReturnValueOnce({
      pageTitle: "Short",
      readableText: "too short",
      selectedExtractor: "basic",
      selectedReason: "fallback-basic"
    })

    await expect(handleGetPageContent(vi.fn())).rejects.toThrow(
      "Failed to extract meaningful content"
    )
  })
})
