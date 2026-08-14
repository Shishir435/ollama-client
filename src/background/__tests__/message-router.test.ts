import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Runtime } from "webextension-polyfill"
import { handleLoadSelectionOverlay } from "@/background/handlers/handle-selection-messages"
import { browser } from "@/lib/browser-api"
import {
  CONTENT_MESSAGE_PROTOCOL_VERSION,
  SELECTION_OVERLAY_REQUEST_ID_GLOBAL,
  type SelectionOverlayLoadRequest
} from "@/protocol/content-messages"
import type { SendResponseFunction } from "@/types/messaging"

describe("handleLoadSelectionOverlay", () => {
  const executeScript = vi.fn()
  const request: SelectionOverlayLoadRequest = {
    version: CONTENT_MESSAGE_PROTOCOL_VERSION,
    requestId: "request-1",
    document: {
      url: "https://example.com/frame",
      isTopFrame: false
    }
  }

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
        request,
        {
          tab: { id: 17 },
          frameId: 4,
          documentId: "document-1"
        } as unknown as Runtime.MessageSender,
        sendResponse
      )
    ).toBe(true)

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        data: {
          requestId: "request-1",
          tabId: 17,
          frameId: 4,
          documentId: "document-1"
        }
      })
    })
    expect(executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 17, frameIds: [4] },
      func: expect.any(Function),
      args: [SELECTION_OVERLAY_REQUEST_ID_GLOBAL, "request-1"]
    })
    expect(executeScript).toHaveBeenNthCalledWith(2, {
      target: { tabId: 17, frameIds: [4] },
      files: ["content-scripts/selection-overlay.js"]
    })
  })

  it("reports injection failures so the sentinel can retry", async () => {
    executeScript.mockRejectedValue(new Error("Frame navigated"))
    const sendResponse = vi.fn<SendResponseFunction>()

    handleLoadSelectionOverlay(
      request,
      { tab: { id: 17 }, frameId: 4 } as unknown as Runtime.MessageSender,
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
      handleLoadSelectionOverlay(
        request,
        {} as Runtime.MessageSender,
        sendResponse
      )
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

  it("rejects unversioned requests", () => {
    const sendResponse = vi.fn<SendResponseFunction>()

    expect(
      handleLoadSelectionOverlay(
        { requestId: "request-1" },
        { tab: { id: 17 } } as Runtime.MessageSender,
        sendResponse
      )
    ).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: {
        status: 400,
        message: "Invalid selection overlay request"
      }
    })
    expect(executeScript).not.toHaveBeenCalled()
  })
})
