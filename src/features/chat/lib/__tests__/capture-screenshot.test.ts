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

  it("throws when capture returns no data (e.g. a restricted page)", async () => {
    mocks.captureVisibleTab.mockResolvedValue("")
    await expect(captureVisibleTabPng()).rejects.toThrow()
  })
})
