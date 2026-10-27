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

describe("embedded frames", () => {
  const executeScript = vi.mocked(browser.scripting.executeScript)

  beforeEach(() => {
    vi.clearAllMocks()
    clearTabContentCache()
    getTab.mockResolvedValue({ url: "https://claude.ai/a", title: "A" } as any)
  })

  it("pins the top read to frame 0 and appends each child frame", async () => {
    executeScript.mockResolvedValue([{ frameId: 0 }, { frameId: 13 }] as any)
    sendMessage.mockImplementation(
      async (_tab: number, _msg: any, opts: any) =>
        opts.frameId === 0
          ? { success: true, html: "shell", title: "A" }
          : {
              success: true,
              html: "artifact body",
              title: "B",
              extractionDebug: { url: "https://x.claudeusercontent.com/p" }
            }
    )

    const result = await readTabContent(1)

    expect(sendMessage.mock.calls[0][2]).toEqual({ frameId: 0 })
    expect(result.html).toContain("shell")
    expect(result.html).toContain(
      "--- Embedded frame https://x.claudeusercontent.com ---\nartifact body"
    )
  })

  it("names a frame that declined instead of treating it as empty", async () => {
    executeScript.mockResolvedValue([{ frameId: 0 }, { frameId: 7 }] as any)
    sendMessage.mockImplementation(
      async (_tab: number, _msg: any, opts: any) =>
        opts.frameId === 0
          ? { success: true, html: "shell", title: "A" }
          : {
              success: false,
              html: "This page is excluded by your settings.",
              title: "x"
            }
    )

    const result = await readTabContent(1)

    expect(result.html).toContain("[Embedded frame frame 7 was not read:")
  })

  it("names a frame whose extractor errored but hides an empty one", async () => {
    executeScript.mockResolvedValue([
      { frameId: 0 },
      { frameId: 4 },
      { frameId: 5 }
    ] as any)
    sendMessage.mockImplementation(
      async (_tab: number, _msg: any, opts: any) => {
        if (opts.frameId === 0)
          return { success: true, html: "shell", title: "A" }
        return opts.frameId === 4
          ? {
              success: false,
              reason: "error",
              html: "Failed to parse content.",
              title: "x"
            }
          : {
              success: false,
              reason: "empty",
              html: "Failed to parse content. Error: empty",
              title: "x"
            }
      }
    )

    const result = await readTabContent(1)

    expect(result.html).toContain("[Embedded frame frame 4 was not read:")
    expect(result.html).not.toContain("frame 5")
  })

  it("reads child frames when the top document has no text of its own", async () => {
    executeScript.mockResolvedValue([{ frameId: 0 }, { frameId: 9 }] as any)
    sendMessage.mockImplementation(
      async (_tab: number, _msg: any, opts: any) =>
        opts.frameId === 0
          ? { success: false, reason: "empty", html: "none", title: "A" }
          : { success: true, html: "iframe only", title: "B" }
    )

    const result = await readTabContent(1)

    expect(result.success).toBe(true)
    expect(result.html).toContain("iframe only")
  })

  it("does not read the frames of an excluded page", async () => {
    sendMessage.mockResolvedValue({
      success: false,
      reason: "excluded",
      html: "excluded",
      title: "A"
    })

    const result = await readTabContent(1)

    expect(result.success).toBe(false)
    expect(executeScript).not.toHaveBeenCalled()
  })
})
