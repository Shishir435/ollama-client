import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  onInputEnteredAddListener: vi.fn(),
  setDefaultSuggestion: vi.fn(),
  tabsQuery: vi.fn(),
  runtimeSendMessage: vi.fn(),
  setPlasmoStoredValue: vi.fn(),
  supportsOmnibox: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  supportsOmnibox: mocks.supportsOmnibox,
  browser: {
    tabs: {
      query: mocks.tabsQuery
    },
    runtime: {
      sendMessage: mocks.runtimeSendMessage
    }
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  setPlasmoStoredValue: mocks.setPlasmoStoredValue
}))

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() }
}))

import { registerOmniboxQuickAsk } from "@/background/lib/omnibox"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.supportsOmnibox.mockReturnValue(true)
  mocks.tabsQuery.mockResolvedValue([{ id: 12, windowId: 34 }])
  mocks.runtimeSendMessage.mockResolvedValue(undefined)
  mocks.setPlasmoStoredValue.mockResolvedValue(undefined)
  vi.stubGlobal("chrome", {
    omnibox: {
      setDefaultSuggestion: mocks.setDefaultSuggestion,
      onInputEntered: {
        addListener: mocks.onInputEnteredAddListener
      }
    }
  })
})

describe("registerOmniboxQuickAsk", () => {
  it("registers omnibox prompt and sends query to chat", async () => {
    const openChatSurface = vi.fn()

    registerOmniboxQuickAsk(openChatSurface)

    expect(mocks.setDefaultSuggestion).toHaveBeenCalledWith({
      description: "Ask Ollama Client"
    })
    expect(mocks.onInputEnteredAddListener).toHaveBeenCalledTimes(1)

    // Cache is primed asynchronously on register; wait for it to resolve so the
    // listener can open the panel synchronously from the cached tab.
    await vi.waitFor(() => expect(mocks.tabsQuery).toHaveBeenCalled())
    await Promise.resolve()

    const onInputEntered = mocks.onInputEnteredAddListener.mock.calls[0][0]
    onInputEntered(" explain sqlite wasm ", "currentTab")

    expect(openChatSurface).toHaveBeenCalledWith({ id: 12, windowId: 34 })

    await vi.waitFor(() =>
      expect(mocks.setPlasmoStoredValue).toHaveBeenCalledWith(
        STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY,
        "explain sqlite wasm"
      )
    )
    expect(mocks.runtimeSendMessage).toHaveBeenCalledWith({
      type: MESSAGE_KEYS.BROWSER.OMNIBOX_QUERY,
      payload: "explain sqlite wasm",
      disposition: "currentTab",
      fromBackground: true
    })
  })

  it("ignores empty input", async () => {
    registerOmniboxQuickAsk(vi.fn())

    const onInputEntered = mocks.onInputEnteredAddListener.mock.calls[0][0]
    onInputEntered("   ")

    await Promise.resolve()
    expect(mocks.setPlasmoStoredValue).not.toHaveBeenCalled()
  })
})
