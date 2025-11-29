import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

// Use vi.hoisted to create mocks
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  addListener: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  openSidePanel: vi.fn().mockResolvedValue(undefined)
}))

// Mock browser API
vi.mock("@/lib/browser-api", () => ({
  browser: {
    contextMenus: {
      create: mocks.create,
      onClicked: {
        addListener: mocks.addListener
      }
    },
    runtime: {
      lastError: undefined,
      sendMessage: mocks.sendMessage
    },
    sidePanel: {
      open: mocks.openSidePanel
    }
  }
}))

describe("handle-context-menu", () => {
  let clickListener: any

  beforeAll(async () => {
    vi.resetModules()
    const { initializeContextMenu } = await import("../handle-context-menu")
    initializeContextMenu()
    
    // Capture the listener immediately after initialization
    if (mocks.addListener.mock.calls.length > 0) {
      clickListener = mocks.addListener.mock.calls[0][0]
    }
  })

  beforeEach(() => {
    mocks.sendMessage.mockClear()
    mocks.openSidePanel.mockClear()
    // Do NOT clear create or addListener as they are called once during init
  })

  it("should create context menu with correct configuration", () => {
    expect(mocks.create).toHaveBeenCalledWith(
      {
        id: "add-to-ollama-client",
        title: "Ask Ollama Client",
        contexts: ["selection"]
      },
      expect.any(Function)
    )
  })

  it("should register click listener", () => {
    expect(clickListener).toBeDefined()
    expect(typeof clickListener).toBe("function")
  })

  it("should handle context menu click with selection text", async () => {
    const mockInfo = {
      menuItemId: "add-to-ollama-client",
      selectionText: "test selection"
    }

    const mockTab = {
      windowId: 123
    }

    await clickListener(mockInfo, mockTab)

    expect(mocks.openSidePanel).toHaveBeenCalledWith({ windowId: 123 })
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "add-selection-to-chat",
      payload: "test selection",
      fromBackground: true
    })
  })

  it("should not process click if menuItemId does not match", async () => {
    const mockInfo = {
      menuItemId: "different-menu-id",
      selectionText: "test selection"
    }

    await clickListener(mockInfo, { windowId: 123 })

    expect(mocks.openSidePanel).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it("should not process click if no selection text", async () => {
    const mockInfo = {
      menuItemId: "add-to-ollama-client",
      selectionText: ""
    }

    await clickListener(mockInfo, { windowId: 123 })

    expect(mocks.openSidePanel).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it("should handle click without tab", async () => {
    const mockInfo = {
      menuItemId: "add-to-ollama-client",
      selectionText: "test selection"
    }

    await clickListener(mockInfo, undefined)

    expect(mocks.openSidePanel).not.toHaveBeenCalled()
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "add-selection-to-chat",
      payload: "test selection",
      fromBackground: true
    })
  })

  it("should handle click without windowId", async () => {
    const mockInfo = {
      menuItemId: "add-to-ollama-client",
      selectionText: "test selection"
    }

    await clickListener(mockInfo, { windowId: undefined })

    expect(mocks.openSidePanel).not.toHaveBeenCalled()
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "add-selection-to-chat",
      payload: "test selection",
      fromBackground: true
    })
  })
})
