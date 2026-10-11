import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` }
  }
}))

class FakeWorker {
  static latest: FakeWorker
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    FakeWorker.latest = this
  }
}

describe("native worker cancellation", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.stubGlobal("Worker", FakeWorker)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it("reports an inference timeout without classifying it as user cancellation", async () => {
    const { generateInNativeWorker } = await import("../worker-client")
    const result = generateInNativeWorker("hello")
    const rejected = expect(result).rejects.toMatchObject({
      name: "TimeoutError"
    })
    await vi.advanceTimersByTimeAsync(60000)
    await rejected
    expect(FakeWorker.latest.postMessage).toHaveBeenLastCalledWith({
      id: expect.any(String),
      cancel: true
    })
  })
  it("preserves explicit user cancellation", async () => {
    const { generateInNativeWorker } = await import("../worker-client")
    const controller = new AbortController()
    const result = generateInNativeWorker("hello", controller.signal)
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError"
    })
    controller.abort()
    await rejected
  })
})
