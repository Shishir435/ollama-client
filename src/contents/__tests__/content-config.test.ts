import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getEffectiveConfig: vi.fn(),
  readSetting: vi.fn(),
  readStoredSetting: vi.fn()
}))

vi.mock("@/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/constants")>()),
  DEFAULT_CONTENT_EXTRACTION_CONFIG: {
    contentScraper: "auto",
    enabled: true,
    excludedUrlPatterns: [],
    maxWaitTime: 1000,
    scrollDepth: 0.8,
    scrollStrategy: "incremental",
    siteOverrides: {}
  }
}))

vi.mock("@/lib/content-extractor", () => ({
  getEffectiveConfig: mocks.getEffectiveConfig
}))

vi.mock("@/lib/storage/setting-access", () => ({
  readSetting: mocks.readSetting,
  readStoredSetting: mocks.readStoredSetting
}))

import { resolveActiveConfig } from "../content-config"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readStoredSetting.mockResolvedValue(undefined)
  mocks.readSetting.mockResolvedValue([])
  mocks.getEffectiveConfig.mockImplementation((_url, config) => config)
})

describe("resolveActiveConfig", () => {
  it("uses the stored config and detects a matching regex override", async () => {
    mocks.readStoredSetting.mockResolvedValueOnce({
      contentScraper: "readability",
      enabled: true,
      excludedUrlPatterns: ["private"],
      siteOverrides: {
        "example\\.com/articles": { contentScraper: "defuddle" }
      }
    })

    const result = await resolveActiveConfig(
      "https://example.com/articles/testing"
    )

    expect(mocks.readSetting).not.toHaveBeenCalled()
    expect(mocks.getEffectiveConfig).toHaveBeenCalledWith(
      "https://example.com/articles/testing",
      expect.objectContaining({
        excludedUrlPatterns: ["private"],
        siteOverrides: expect.objectContaining({
          "example\\.com/articles": { contentScraper: "defuddle" }
        })
      }),
      expect.any(Object)
    )
    expect(result.hasSiteOverride).toBe(true)
  })

  it("migrates legacy exclusion patterns when the stored list is empty", async () => {
    mocks.readStoredSetting.mockResolvedValueOnce({
      enabled: false,
      excludedUrlPatterns: [],
      siteOverrides: undefined
    })
    mocks.readSetting.mockResolvedValueOnce(["legacy-private"])

    await resolveActiveConfig("https://example.com")

    expect(mocks.getEffectiveConfig).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        enabled: false,
        excludedUrlPatterns: ["legacy-private"],
        siteOverrides: {}
      }),
      expect.any(Object)
    )
  })

  it("builds from defaults when no stored extraction config exists", async () => {
    mocks.readSetting.mockResolvedValueOnce(["blocked.example"])

    const result = await resolveActiveConfig("https://public.example")

    expect(mocks.getEffectiveConfig).toHaveBeenCalledWith(
      "https://public.example",
      expect.objectContaining({
        contentScraper: "auto",
        enabled: true,
        excludedUrlPatterns: ["blocked.example"]
      }),
      expect.any(Object)
    )
    expect(result.hasSiteOverride).toBe(false)
  })

  it("falls back to substring matching for an invalid regex override", async () => {
    mocks.readStoredSetting.mockResolvedValueOnce({
      enabled: true,
      excludedUrlPatterns: ["keep-current"],
      siteOverrides: { "[broken": { enabled: false } }
    })

    const result = await resolveActiveConfig(
      "https://example.com/path/[broken/page"
    )

    expect(result.hasSiteOverride).toBe(true)
  })
})
