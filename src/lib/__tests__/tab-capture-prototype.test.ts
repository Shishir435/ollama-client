import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  chromium: vi.fn(),
  tabCapture: vi.fn(),
  offscreen: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  isChromiumBased: mocks.chromium,
  supportsTabCapture: mocks.tabCapture,
  supportsOffscreenDocuments: mocks.offscreen
}))

import { assessTabCapturePrototype } from "@/lib/tab-capture-prototype"

describe("tab capture prototype assessment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chromium.mockReturnValue(true)
    mocks.tabCapture.mockReturnValue(true)
    mocks.offscreen.mockReturnValue(true)
  })

  it("marks Chrome 116+ APIs technically feasible but not shippable yet", () => {
    const result = assessTabCapturePrototype()

    expect(result.feasible).toBe(true)
    expect(result.blockers).toEqual([
      "transcription-pipeline-missing",
      "interactive-stop-control-missing"
    ])
    expect(result.requiredPermissions).toEqual(["tabCapture", "offscreen"])
    expect(result.persistenceDefault).toBe("ephemeral")
  })

  it("reports Firefox as unsupported without pretending controls can work", () => {
    mocks.chromium.mockReturnValue(false)

    const result = assessTabCapturePrototype()

    expect(result.feasible).toBe(false)
    expect(result.blockers).toContain("firefox-unsupported")
    expect(mocks.tabCapture).not.toHaveBeenCalled()
    expect(mocks.offscreen).not.toHaveBeenCalled()
  })

  it("reports missing Chromium APIs separately", () => {
    mocks.tabCapture.mockReturnValue(false)
    mocks.offscreen.mockReturnValue(false)

    const result = assessTabCapturePrototype()

    expect(result.feasible).toBe(false)
    expect(result.blockers).toContain("tab-capture-unavailable")
    expect(result.blockers).toContain("offscreen-unavailable")
  })
})
