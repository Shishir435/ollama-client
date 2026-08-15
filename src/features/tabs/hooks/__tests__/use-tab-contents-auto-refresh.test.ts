import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/features/tabs/hooks/use-open-tab", () => ({
  useOpenTabs: vi.fn(() => ({ tabs: [], refreshTabs: vi.fn() }))
}))

vi.mock("@/hooks/use-setting", () => ({
  useSetting: vi.fn(() => [true, vi.fn(), { isLoading: false }])
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: { sendMessage: vi.fn() },
    scripting: { executeScript: vi.fn() }
  }
}))

import { useSelectedTabsStore } from "@/features/tabs/stores/selected-tabs-store"
import { browser } from "@/lib/browser-api"
import { TAB_CONTENT_REFRESH_INTERVAL_MS } from "@/lib/constants"
import { useTabContents } from "../use-tab-contents"

const sendMessage = vi.mocked(browser.tabs.sendMessage)

let hidden = false

/** Fake timers are on throughout, so settle work by draining them, not waitFor. */
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    await Promise.resolve()
  })
}

const tick = () => flush(TAB_CONTENT_REFRESH_INTERVAL_MS)

/** Distinct ids per test: the fetching store is module-level and persists. */
let nextTabId = 1000
const freshTabId = () => {
  nextTabId += 1
  return nextTabId
}

const selectTab = (tabId: number) => {
  useSelectedTabsStore.setState({ selectedTabIds: [String(tabId)], errors: {} })
}

describe("useTabContents auto refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hidden = false
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden
    })
    useSelectedTabsStore.setState({ selectedTabIds: [], errors: {} })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    useSelectedTabsStore.setState({ selectedTabIds: [], errors: {} })
  })

  it("runs one refresh timer no matter how many consumers mount", async () => {
    const tabId = freshTabId()
    selectTab(tabId)
    sendMessage.mockResolvedValue({ html: "<p>a</p>", title: "A" })
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")

    const first = renderHook(() => useTabContents())
    const second = renderHook(() => useTabContents())
    const third = renderHook(() => useTabContents())
    await flush()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(
      setIntervalSpy.mock.calls.filter(
        (call) => call[1] === TAB_CONTENT_REFRESH_INTERVAL_MS
      )
    ).toHaveLength(1)

    await tick()

    // Three mounted consumers used to mean three concurrent extractions.
    expect(sendMessage).toHaveBeenCalledTimes(2)

    first.unmount()
    second.unmount()
    expect(clearIntervalSpy).not.toHaveBeenCalled()

    third.unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it("does not start a second extraction for a tab already being read", async () => {
    const tabId = freshTabId()
    selectTab(tabId)
    let release: ((value: unknown) => void) | undefined
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )

    const { result, unmount } = renderHook(() => useTabContents())
    await flush()
    expect(sendMessage).toHaveBeenCalledTimes(1)

    // The manual path forces, which used to mean "ignore the in-flight fetch".
    await act(async () => {
      void result.current.refreshSelectedTabContents()
    })
    await flush()
    expect(sendMessage).toHaveBeenCalledTimes(1)

    await tick()
    expect(sendMessage).toHaveBeenCalledTimes(1)

    await act(async () => {
      release?.({ html: "<p>a</p>", title: "A" })
    })
    await flush()
    unmount()
  })

  it("pauses while the document is hidden and re-checks when it returns", async () => {
    const tabId = freshTabId()
    selectTab(tabId)
    sendMessage.mockResolvedValue({ html: "<p>a</p>", title: "A" })

    const { unmount } = renderHook(() => useTabContents())
    await flush()
    expect(sendMessage).toHaveBeenCalledTimes(1)

    hidden = true
    await tick()
    await tick()
    expect(sendMessage).toHaveBeenCalledTimes(1)

    hidden = false
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await flush()
    expect(sendMessage).toHaveBeenCalledTimes(2)

    unmount()
  })

  it("keeps the cached entry when the content hash is unchanged", async () => {
    const tabId = freshTabId()
    selectTab(tabId)
    const extractionDebug = {
      url: "https://example.com",
      title: "A",
      scraper: "basic",
      hasTranscript: false,
      transcriptLength: 0,
      contentLength: 3,
      contentHash: "hash-1"
    }
    sendMessage.mockResolvedValue({
      html: "<p>a</p>",
      title: "A",
      extractionDebug
    })

    const { result, unmount } = renderHook(() => useTabContents())
    await flush()
    const cached = result.current.tabContents[tabId]
    expect(cached).toBeDefined()

    await tick()
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(result.current.tabContents[tabId]).toBe(cached)
    expect(result.current.updatedIds[tabId]).toBeFalsy()

    sendMessage.mockResolvedValue({
      html: "<p>b</p>",
      title: "A",
      extractionDebug: { ...extractionDebug, contentHash: "hash-2" }
    })
    await tick()
    expect(result.current.tabContents[tabId]?.html).toBe("<p>b</p>")
    expect(result.current.updatedIds[tabId]).toBe(true)

    unmount()
  })
})
