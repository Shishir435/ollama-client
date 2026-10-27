// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  prompt: vi.fn(() => ({}))
}))

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: mocks.call }
}))
vi.mock("@/lib/providers/browser-built-in/api", () => ({
  promptAPI: mocks.prompt
}))

import { observeBrowserModelStatus } from "../browser-model-observer"

describe("browser model status observer", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.call.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reads once and then stops while the model is not downloading", async () => {
    mocks.call.mockResolvedValue({ availability: "available", enabled: true })
    const stop = observeBrowserModelStatus(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })

  it("polls only while a download is in progress", async () => {
    mocks.call.mockResolvedValue({
      availability: "downloading",
      enabled: true
    })
    const stop = observeBrowserModelStatus(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.call.mock.calls.length).toBeGreaterThanOrEqual(3)

    mocks.call.mockResolvedValue({ availability: "available", enabled: true })
    await vi.advanceTimersByTimeAsync(5_000)
    const settled = mocks.call.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.call).toHaveBeenCalledTimes(settled)
    stop()
  })

  it("retries a failed first read a bounded number of times", async () => {
    mocks.call.mockRejectedValue(new Error("worker unavailable"))
    const stop = observeBrowserModelStatus(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60_000)

    // The first read plus three delayed retries, then it waits for a mount or visibility change.
    expect(mocks.call).toHaveBeenCalledTimes(4)
    stop()
  })

  it("recovers when a retry succeeds", async () => {
    const seen = vi.fn()
    mocks.call
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockResolvedValue({ availability: "available", enabled: true })
    const stop = observeBrowserModelStatus(seen)
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(seen).toHaveBeenCalledWith({
      availability: "available",
      enabled: true
    })
    stop()
  })
})
