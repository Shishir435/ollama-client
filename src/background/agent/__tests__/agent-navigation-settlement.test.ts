import { afterEach, describe, expect, it, vi } from "vitest"
import { waitForAgentNavigation } from "../agent-navigation-settlement"

const base = {
  tabId: 1,
  sourceUrl: "https://example.com/",
  destinationUrl: "https://example.com/details"
}

afterEach(() => vi.useRealTimers())

describe("navigation settlement", () => {
  it("waits through request acknowledgement and loading before returning", async () => {
    vi.useFakeTimers()
    const getTab = vi
      .fn()
      .mockResolvedValueOnce({ url: base.sourceUrl, status: "complete" })
      .mockResolvedValueOnce({ url: base.destinationUrl, status: "loading" })
      .mockResolvedValue({ url: base.destinationUrl, status: "complete" })
    let settled = false
    const pending = waitForAgentNavigation({
      ...base,
      getTab,
      signal: new AbortController().signal
    }).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    await pending
    expect(getTab).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("bounds an uncommitted navigation without repeating any browser action", async () => {
    vi.useFakeTimers()
    const getTab = vi
      .fn()
      .mockResolvedValue({ url: base.sourceUrl, status: "complete" })
    const pending = waitForAgentNavigation({
      ...base,
      getTab,
      signal: new AbortController().signal,
      timeoutMs: 250
    })
    const rejected = expect(pending).rejects.toThrow("did not settle")
    await vi.advanceTimersByTimeAsync(250)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it("cancels promptly and releases its timer", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const getTab = vi
      .fn()
      .mockResolvedValue({ url: base.sourceUrl, status: "loading" })
    const pending = waitForAgentNavigation({
      ...base,
      getTab,
      signal: controller.signal
    })
    const rejected = expect(pending).rejects.toThrow("cancelled")
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
})
