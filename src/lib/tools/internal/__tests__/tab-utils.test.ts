import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: { sendMessage: vi.fn(), get: vi.fn() },
    scripting: { executeScript: vi.fn() },
    webNavigation: { getAllFrames: vi.fn() }
  }
}))

vi.mock("@/lib/pdf-tab/pdf-tab-client", () => ({ readPdfTab: vi.fn() }))
vi.mock("@/lib/storage/setting-access", () => ({
  readSetting: vi.fn(async () => true)
}))

import { browser } from "@/lib/browser-api"
import { readPdfTab } from "@/lib/pdf-tab/pdf-tab-client"
import { readSetting } from "@/lib/storage/setting-access"
import { clearTabContentCache, readTabContent } from "../tab-utils"

const readPdf = vi.mocked(readPdfTab)

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

  it("serves nothing cached once tab access is turned off", async () => {
    await readTabContent(1)
    vi.mocked(readSetting).mockResolvedValueOnce(false)

    const response = await readTabContent(1)

    expect(response).toMatchObject({ success: false, reason: "disabled" })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    /** The cache went with it: turned back on, the page is read afresh. */
    await readTabContent(1)
    expect(sendMessage).toHaveBeenCalledTimes(2)
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

  it("keeps a failed read unsuccessful when frames only report notices", async () => {
    executeScript.mockResolvedValue([{ frameId: 0 }, { frameId: 9 }] as any)
    sendMessage.mockImplementation(
      async (_tab: number, _msg: any, opts: any) =>
        opts.frameId === 0
          ? { success: false, reason: "empty", html: "none", title: "A" }
          : { success: false, reason: "excluded", html: "excluded", title: "B" }
    )

    const first = await readTabContent(1)
    await readTabContent(1)

    expect(first.success).toBe(false)
    expect(first.html).toContain("[Embedded frame frame 9 was not read:")
    // Not cached: the second read asks the tab again.
    expect(
      sendMessage.mock.calls.filter((c: any) => c[2].frameId === 0)
    ).toHaveLength(2)
  })

  it("names a frame by origin and appends none of its text when asked to", async () => {
    executeScript.mockResolvedValue([{ frameId: 0 }, { frameId: 13 }] as any)
    vi.mocked(browser.webNavigation.getAllFrames).mockResolvedValue([
      { frameId: 0, url: "https://claude.ai/a" },
      { frameId: 13, url: "https://widget.example/p" }
    ] as any)
    sendMessage.mockImplementation(
      async (_tab: number, _msg: any, opts: any) =>
        opts.frameId === 0
          ? { success: true, html: "public code", title: "A" }
          : {
              success: true,
              html: "PRIVATE-CANARY",
              title: "B",
              extractionDebug: { url: "https://widget.example/p" }
            }
    )

    const result = await readTabContent(1, { embeddedFrames: "name" })

    expect(result.html).toContain("public code")
    expect(result.html).toContain(
      "[Embedded frame https://widget.example was left unread"
    )
    expect(result.html).not.toContain("PRIVATE-CANARY")
  })

  it("asks no frame for its content when told to leave them alone", async () => {
    executeScript.mockResolvedValue([{ frameId: 0 }, { frameId: 13 }] as any)
    vi.mocked(browser.webNavigation.getAllFrames).mockResolvedValue([
      { frameId: 0, url: "https://claude.ai/a" },
      { frameId: 13, url: "https://widget.example/p" }
    ] as any)
    sendMessage.mockImplementation(
      async (_tab: number, _msg: any, opts: any) =>
        opts.frameId === 0
          ? { success: true, html: "public code", title: "A" }
          : { success: true, html: "PRIVATE-CANARY", title: "B" }
    )

    const result = await readTabContent(1, { embeddedFrames: "name" })

    expect(sendMessage.mock.calls.map((call) => call[2])).toEqual([
      { frameId: 0 }
    ])
    expect(result.html).toContain(
      "[Embedded frame https://widget.example was left unread"
    )
  })

  it("counts the frames beyond the cap when leaving them alone", async () => {
    vi.mocked(browser.webNavigation.getAllFrames).mockResolvedValue([
      { frameId: 0, url: "https://claude.ai/a" },
      ...Array.from({ length: 6 }, (_v, index) => ({
        frameId: index + 1,
        url: `https://w${index}.example/p`
      }))
    ] as any)
    sendMessage.mockResolvedValue({ success: true, html: "shell", title: "A" })

    const result = await readTabContent(1, { embeddedFrames: "name" })

    expect(result.html).toContain("[2 more embedded frames were left unread]")
  })

  it("does not turn an empty page into a read of its frames when asked to leave them", async () => {
    executeScript.mockResolvedValue([{ frameId: 0 }, { frameId: 9 }] as any)
    sendMessage.mockImplementation(
      async (_tab: number, _msg: any, opts: any) =>
        opts.frameId === 0
          ? { success: false, reason: "empty", html: "none", title: "A" }
          : { success: true, html: "PRIVATE-CANARY", title: "B" }
    )

    const result = await readTabContent(1, { embeddedFrames: "name" })

    expect(result.success).toBe(false)
    expect(result.html).not.toContain("PRIVATE-CANARY")
  })

  it("never answers a request to leave frames out from text read with them", async () => {
    executeScript.mockResolvedValue([{ frameId: 0 }, { frameId: 13 }] as any)
    sendMessage.mockImplementation(
      async (_tab: number, _msg: any, opts: any) =>
        opts.frameId === 0
          ? { success: true, html: "public code", title: "A" }
          : { success: true, html: "PRIVATE-CANARY", title: "B" }
    )

    const read = await readTabContent(1)
    const excluded = await readTabContent(1, { embeddedFrames: "name" })
    const again = await readTabContent(1)

    expect(read.html).toContain("PRIVATE-CANARY")
    expect(excluded.html).not.toContain("PRIVATE-CANARY")
    expect(again.html).toContain("PRIVATE-CANARY")
  })
})

describe("PDF tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearTabContentCache()
    readPdf.mockResolvedValue({
      ok: true,
      title: "Paper",
      text: "--- Page 1 ---\nHi"
    })
  })

  const tabAt = (url: string, title = "Paper") =>
    getTab.mockResolvedValue({ url, title } as any)

  it("reads a .pdf tab by fetching the document, never asking the page", async () => {
    tabAt("https://example.com/paper.pdf")

    const response = await readTabContent(7)

    expect(response).toEqual({
      success: true,
      title: "Paper",
      html: "--- Page 1 ---\nHi"
    })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(browser.scripting.executeScript).not.toHaveBeenCalled()
    expect(readPdf).toHaveBeenCalledWith(
      { url: "https://example.com/paper.pdf", title: "Paper" },
      expect.objectContaining({ force: false })
    )
  })

  it("refuses a PDF tab while tab access is off, as the content script does", async () => {
    tabAt("https://example.com/paper.pdf")
    vi.mocked(readSetting).mockResolvedValueOnce(false)

    const response = await readTabContent(7)

    expect(response).toMatchObject({ success: false, reason: "disabled" })
    expect(readPdf).not.toHaveBeenCalled()
  })

  it("reads a PDF served without a .pdf address when the page says it is one", async () => {
    tabAt("https://example.com/download?id=9", "Download")
    sendMessage.mockResolvedValue({
      success: false,
      reason: "pdf",
      html: "This tab is a PDF document.",
      title: "Download"
    })

    const response = await readTabContent(7)

    expect(response).toMatchObject({
      success: true,
      html: "--- Page 1 ---\nHi"
    })
    expect(readPdf).toHaveBeenCalledWith(
      { url: "https://example.com/download?id=9", title: "Download" },
      expect.anything()
    )
  })

  it("returns a failure with an issue the user can read and text the model can act on", async () => {
    tabAt("file:///Users/me/notes.pdf", "notes.pdf")
    readPdf.mockResolvedValue({
      ok: false,
      issue: "pdf_file_access",
      message: "Can't read the local PDF. Do not retry."
    })

    const response = await readTabContent(7)

    expect(response).toEqual({
      success: false,
      reason: "error",
      issue: "pdf_file_access",
      html: "Can't read the local PDF. Do not retry.",
      title: "notes.pdf"
    })
  })

  it("never caches a failed PDF read", async () => {
    tabAt("https://example.com/paper.pdf")
    readPdf.mockResolvedValueOnce({
      ok: false,
      issue: "pdf_unreachable",
      message: "offline"
    })

    await readTabContent(7)
    const second = await readTabContent(7)

    expect(second).toMatchObject({ success: true })
    expect(readPdf).toHaveBeenCalledTimes(2)
  })

  it("passes a forced read and the caller's signal to the reader", async () => {
    tabAt("https://example.com/paper.pdf")
    const controller = new AbortController()

    await readTabContent(7, { force: true, signal: controller.signal })

    expect(readPdf).toHaveBeenCalledWith(expect.anything(), {
      force: true,
      signal: controller.signal
    })
  })

  it("leaves an ordinary page to the content script", async () => {
    tabAt("https://example.com/article")
    sendMessage.mockResolvedValue(pageFor(7))

    await readTabContent(7)

    expect(readPdf).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalled()
  })
})
