import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockPort } from "@/background/handlers/__tests__/test-utils"
import { MESSAGE_KEYS } from "@/lib/constants"
import {
  postSelectionToSidePanels,
  registerSelectionBridgePort,
  unregisterSelectionBridgePort
} from "../selection-bridge"

describe("selection bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("posts selected text to registered side panel ports", () => {
    const port = createMockPort(MESSAGE_KEYS.BROWSER.SELECTION_BRIDGE_PORT)

    expect(registerSelectionBridgePort(port)).toBe(true)

    postSelectionToSidePanels("selected text")

    expect(port.postMessage).toHaveBeenCalledWith({
      type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
      payload: "selected text",
      fromBackground: true
    })

    unregisterSelectionBridgePort(port)
  })

  it("ignores unrelated runtime ports", () => {
    const port = createMockPort("chat-port")

    expect(registerSelectionBridgePort(port)).toBe(false)

    postSelectionToSidePanels("selected text")

    expect(port.postMessage).not.toHaveBeenCalled()
  })

  it("removes disconnected ports after a failed post", () => {
    const port = createMockPort(MESSAGE_KEYS.BROWSER.SELECTION_BRIDGE_PORT)
    vi.mocked(port.postMessage).mockImplementation(() => {
      throw new Error("disconnected")
    })

    registerSelectionBridgePort(port)
    postSelectionToSidePanels("first")
    postSelectionToSidePanels("second")

    expect(port.postMessage).toHaveBeenCalledTimes(1)
  })
})
