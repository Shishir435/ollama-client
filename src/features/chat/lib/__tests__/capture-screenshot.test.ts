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

import { captureVisibleTabImage } from "@/features/chat/lib/capture-screenshot"

// "AAAA" base64 → 3 bytes.
const PNG_URL = "data:image/png;base64,AAAA"
const JPEG_URL = "data:image/jpeg;base64,/9j/AAAA"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrent.mockResolvedValue({ id: 7 })
})

describe("captureVisibleTabImage", () => {
  it("keeps a small capture as lossless PNG (single capture)", async () => {
    mocks.captureVisibleTab.mockResolvedValue(PNG_URL)

    const file = await captureVisibleTabImage(123)

    expect(mocks.captureVisibleTab).toHaveBeenCalledTimes(1)
    expect(mocks.captureVisibleTab).toHaveBeenCalledWith(7, { format: "png" })
    expect(file.type).toBe("image/png")
    expect(file.name).toBe("screenshot-123.png")
    expect(file.size).toBeGreaterThan(0)
  })

  it("re-captures as JPEG when the PNG exceeds the keep threshold", async () => {
    mocks.captureVisibleTab
      .mockResolvedValueOnce(PNG_URL) // png path
      .mockResolvedValueOnce(JPEG_URL) // jpeg fallback
    // Force the PNG (3 bytes) over the threshold.
    const file = await captureVisibleTabImage(123, 1)

    expect(mocks.captureVisibleTab).toHaveBeenCalledTimes(2)
    expect(mocks.captureVisibleTab).toHaveBeenLastCalledWith(7, {
      format: "jpeg",
      quality: 80
    })
    expect(file.type).toBe("image/jpeg")
    expect(file.name).toBe("screenshot-123.jpg")
  })

  it("propagates a rejection on a restricted page (chrome://, Web Store)", async () => {
    mocks.captureVisibleTab.mockRejectedValue(
      new Error("Cannot capture a restricted page")
    )
    await expect(captureVisibleTabImage()).rejects.toThrow(/restricted/)
  })

  it("throws when capture resolves with empty data", async () => {
    mocks.captureVisibleTab.mockResolvedValue("")
    await expect(captureVisibleTabImage()).rejects.toThrow()
  })

  it("throws when the current window has no id", async () => {
    mocks.getCurrent.mockResolvedValue({})
    await expect(captureVisibleTabImage()).rejects.toThrow(/window/)
  })
})
