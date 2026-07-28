import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Runtime } from "webextension-polyfill"
import { handleLoadSelectionOverlay } from "@/background/message-router"
import { browser } from "@/lib/browser-api"
import type { SendResponseFunction } from "@/types/messaging"

describe("handleLoadSelectionOverlay", () => {
  const executeScript = vi.fn()

  beforeEach(() => {
    ;(
      browser as unknown as {
        scripting: { executeScript: typeof executeScript }
      }
    ).scripting = { executeScript }
  })

  it("reports success after injecting into the source frame", async () => {
    executeScript.mockResolvedValue([])
    const sendResponse = vi.fn<SendResponseFunction>()

    expect(
      handleLoadSelectionOverlay(
        { tab: { id: 17 }, frameId: 4 } as Runtime.MessageSender,
        sendResponse
      )
    ).toBe(true)

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ success: true })
    })
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 17, frameIds: [4] },
      files: ["content-scripts/selection-overlay.js"]
    })
  })

  it("reports injection failures so the sentinel can retry", async () => {
    executeScript.mockRejectedValue(new Error("Frame navigated"))
    const sendResponse = vi.fn<SendResponseFunction>()

    handleLoadSelectionOverlay(
      { tab: { id: 17 }, frameId: 4 } as Runtime.MessageSender,
      sendResponse
    )

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: { status: 0, message: "Frame navigated" }
      })
    })
  })

  it("rejects requests without a source tab", () => {
    const sendResponse = vi.fn<SendResponseFunction>()

    expect(
      handleLoadSelectionOverlay({} as Runtime.MessageSender, sendResponse)
    ).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: {
        status: 400,
        message: "Selection overlay requires a source tab"
      }
    })
    expect(executeScript).not.toHaveBeenCalled()
  })
})
