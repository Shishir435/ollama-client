import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  captureVisibleTab: vi.fn(),
  classifyTabAccess: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: {
      query: (...args: unknown[]) => mocks.query(...args),
      captureVisibleTab: (...args: unknown[]) =>
        mocks.captureVisibleTab(...args)
    }
  }
}))

vi.mock("../tab-utils", () => ({
  classifyTabAccess: (...args: unknown[]) => mocks.classifyTabAccess(...args),
  accessDeniedMessage: (access: string, label: string) =>
    `denied:${access}:${label}`,
  queryActiveTab: async () => (await mocks.query({ active: true }))[0]
}))

import {
  captureScreenshotDefinition,
  runCaptureScreenshot
} from "../capture-screenshot-tool"

const smallPng = `data:image/png;base64,${"A".repeat(40)}`

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue([
    { id: 9, windowId: 3, url: "https://example.test", title: "Example" }
  ])
  mocks.classifyTabAccess.mockResolvedValue("ok")
  mocks.captureVisibleTab.mockResolvedValue(smallPng)
})

describe("capture_screenshot definition", () => {
  it("requires vision so non-vision models never get it", () => {
    expect(captureScreenshotDefinition.requires).toContain("vision")
    expect(captureScreenshotDefinition.requires).toContain("tabs")
  })

  it("binds its approval grant to the active tab's origin", async () => {
    mocks.query.mockResolvedValue([
      { id: 9, windowId: 3, url: "https://example.test/some/page?q=1" }
    ])
    await expect(
      captureScreenshotDefinition.grantScopeResolver?.({}, {})
    ).resolves.toBe("https://example.test")
  })

  it("resolves no origin on internal pages so no grant applies", async () => {
    mocks.query.mockResolvedValue([
      { id: 9, windowId: 3, url: "chrome://settings" }
    ])
    await expect(
      captureScreenshotDefinition.grantScopeResolver?.({}, {})
    ).resolves.toBeUndefined()
  })
})

describe("capture_screenshot tool", () => {
  it("refuses to capture when the active origin no longer matches the approval", async () => {
    mocks.query.mockResolvedValue([
      { id: 9, windowId: 3, url: "https://bank.example/account" }
    ])

    const result = await runCaptureScreenshot(
      {},
      { approvedOrigin: "https://github.com" }
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain("https://github.com")
    expect(mocks.captureVisibleTab).not.toHaveBeenCalled()
  })

  it("captures when the active origin still matches the approval", async () => {
    const result = await runCaptureScreenshot(
      {},
      { approvedOrigin: "https://example.test" }
    )
    expect(result.isError).toBeUndefined()
    expect(mocks.captureVisibleTab).toHaveBeenCalled()
  })

  it("returns the screenshot as raw base64 image content", async () => {
    const result = await runCaptureScreenshot({}, {})
    expect(result.isError).toBeUndefined()
    expect(result.images).toHaveLength(1)
    expect(result.images?.[0]).toEqual({
      base64: "A".repeat(40),
      mimeType: "image/png"
    })
    // base64 must be stripped of the data: prefix for the provider message shape.
    expect(result.images?.[0].base64.startsWith("data:")).toBe(false)
    expect(result.sources?.[0]?.url).toBe("https://example.test")
  })

  it("re-captures as JPEG when the PNG is too large", async () => {
    const bigPng = `data:image/png;base64,${"A".repeat(3_000_000)}`
    const jpeg = `data:image/jpeg;base64,${"B".repeat(50)}`
    mocks.captureVisibleTab
      .mockResolvedValueOnce(bigPng)
      .mockResolvedValueOnce(jpeg)

    const result = await runCaptureScreenshot({}, {})
    expect(result.images?.[0].mimeType).toBe("image/jpeg")
    expect(mocks.captureVisibleTab).toHaveBeenCalledTimes(2)
    expect(mocks.captureVisibleTab.mock.calls[1][1]).toMatchObject({
      format: "jpeg"
    })
  })

  it("refuses an excluded tab without capturing", async () => {
    mocks.classifyTabAccess.mockResolvedValue("excluded")
    const result = await runCaptureScreenshot({}, {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain("denied:excluded")
    expect(mocks.captureVisibleTab).not.toHaveBeenCalled()
  })

  it("errors when there is no active tab", async () => {
    mocks.query.mockResolvedValue([])
    const result = await runCaptureScreenshot({}, {})
    expect(result.isError).toBe(true)
    expect(mocks.captureVisibleTab).not.toHaveBeenCalled()
  })

  it("surfaces a capture failure as an error result", async () => {
    mocks.captureVisibleTab.mockRejectedValue(new Error("restricted page"))
    const result = await runCaptureScreenshot({}, {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain("Could not capture a screenshot")
  })
})
