import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: { sendMessage: vi.fn(), get: vi.fn() },
    scripting: { executeScript: vi.fn() }
  }
}))

import { browser } from "@/lib/browser-api"
import { clearTabContentCache, readTabContent } from "../tab-utils"

const sendMessage = vi.mocked(browser.tabs.sendMessage)
const getTab = vi.mocked(browser.tabs.get)

const pageFor = (tabId: number, html = `<p>${tabId}</p>`) => ({
  html,
  title: `Tab ${tabId}`
})

describe("tab content cache", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearTabContentCache()
    getTab.mockImplementation(
      async (tabId: number) =>
        ({
          url: `https://example.com/${tabId}`,
          title: `Tab ${tabId}`
        }) as any
    )
    sendMessage.mockImplementation(async (tabId: number) => pageFor(tabId))
  })

  it("serves a repeated read from the cache", async () => {
    await readTabContent(1)
    await readTabContent(1)

    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("drops a single tab's entry when that tab is evicted", async () => {
    await readTabContent(1)
    clearTabContentCache(1)
    await readTabContent(1)

    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it("evicts the least recently used tab once the cap is reached", async () => {
    for (let tabId = 1; tabId <= 16; tabId += 1) await readTabContent(tabId)
    // Tab 1 is the oldest, so touching tab 2 makes tab 1 the eviction target.
    await readTabContent(2)
    sendMessage.mockClear()

    await readTabContent(99)
    expect(sendMessage).toHaveBeenCalledTimes(1)

    await readTabContent(1)
    expect(sendMessage).toHaveBeenCalledTimes(2)

    await readTabContent(2)
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it("returns an oversized page without giving it a cache slot", async () => {
    const huge = "x".repeat(1_000_001)
    sendMessage.mockImplementation(async (tabId: number) =>
      pageFor(tabId, huge)
    )

    const first = await readTabContent(7)
    expect(first.html).toHaveLength(huge.length)

    await readTabContent(7)
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it("keeps other tabs cached while an oversized page passes through", async () => {
    await readTabContent(3)
    sendMessage.mockImplementation(async (tabId: number) =>
      pageFor(tabId, "x".repeat(1_000_001))
    )
    await readTabContent(4)
    sendMessage.mockImplementation(async (tabId: number) => pageFor(tabId))
    sendMessage.mockClear()

    await readTabContent(3)
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
