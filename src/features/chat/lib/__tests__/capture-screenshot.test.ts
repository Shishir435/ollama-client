import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  captureVisibleTab: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    windows: { getCurrent: mocks.getCurrent },
    tabs: { captureVisibleTab: mocks.captureVisibleTab }
  }
}))

import { captureVisibleTabPng } from "@/features/chat/lib/capture-screenshot"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrent.mockResolvedValue({ id: 7 })
})

describe("captureVisibleTabPng", () => {
  it("captures the current window's tab as a PNG File", async () => {
    mocks.captureVisibleTab.mockResolvedValue("data:image/png;base64,AAAA")

    const file = await captureVisibleTabPng(123)

    expect(mocks.captureVisibleTab).toHaveBeenCalledWith(7, { format: "png" })
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe("image/png")
    expect(file.name).toBe("screenshot-123.png")
    expect(file.size).toBeGreaterThan(0)
  })

  it("propagates a rejection on a restricted page (chrome://, Web Store)", async () => {
    mocks.captureVisibleTab.mockRejectedValue(
      new Error("Cannot capture a restricted page")
    )
    await expect(captureVisibleTabPng()).rejects.toThrow(/restricted/)
  })

  it("throws when capture resolves with empty data", async () => {
    mocks.captureVisibleTab.mockResolvedValue("")
    await expect(captureVisibleTabPng()).rejects.toThrow()
  })

  it("throws when the current window has no id", async () => {
    mocks.getCurrent.mockResolvedValue({})
    await expect(captureVisibleTabPng()).rejects.toThrow(/window/)
  })
})
