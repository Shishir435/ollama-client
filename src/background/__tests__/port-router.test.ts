import { beforeEach, describe, expect, it, vi } from "vitest"

import { MESSAGE_KEYS } from "@/lib/constants"

const connectListeners = new Set<(port: unknown) => void>()

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      id: "extension-id",
      getURL: () => "chrome-extension://extension-id/",
      onConnect: {
        addListener: (listener: (port: unknown) => void) => {
          connectListeners.add(listener)
        }
      }
    }
  }
}))

const { registerPortRouter } = await import("@/background/port-router")

const createPort = (name: string) => ({
  name,
  sender: {
    id: "extension-id",
    url: "chrome-extension://extension-id/sidepanel.html"
  },
  postMessage: vi.fn(),
  disconnect: vi.fn(),
  onMessage: { addListener: vi.fn() },
  onDisconnect: { addListener: vi.fn() }
})

const connect = (port: unknown) => {
  for (const listener of connectListeners) listener(port)
}

describe("registerPortRouter", () => {
  beforeEach(() => {
    connectListeners.clear()
    registerPortRouter()
  })

  it("takes the chat and selection ports it owns", () => {
    for (const name of [
      MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE,
      MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
      MESSAGE_KEYS.BROWSER.SELECTION_BRIDGE_PORT
    ]) {
      const port = createPort(name)
      connect(port)
      expect(port.onMessage.addListener).toHaveBeenCalled()
      expect(port.disconnect).not.toHaveBeenCalled()
    }
  })

  it("leaves another feature's port entirely alone", () => {
    const port = createPort(MESSAGE_KEYS.AGENT.RUN_PORT)

    connect(port)

    expect(port.onMessage.addListener).not.toHaveBeenCalled()
    expect(port.onDisconnect.addListener).not.toHaveBeenCalled()
    expect(port.disconnect).not.toHaveBeenCalled()
  })
})
