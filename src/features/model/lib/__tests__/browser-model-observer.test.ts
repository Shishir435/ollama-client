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
})
