import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  details: vi.fn(),
  rpc: vi.fn()
}))
vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: { getProviderForModel: mocks.resolve }
}))
vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: mocks.rpc }
}))

import { fetchModelInfo } from "../fetch-model-info"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockResolvedValue({
    capabilities: { modelDetails: true },
    getModelDetails: mocks.details
  })
})
afterEach(() => vi.useRealTimers())

describe("shared model details queue", () => {
  it("bounds concurrent fetches and removes cancelled queued models", async () => {
    const releases: (() => void)[] = []
    mocks.details.mockImplementation(
      () =>
        new Promise((resolve) =>
          releases.push(() => resolve({ capabilities: ["tools"] }))
        )
    )
    const cancel = new AbortController()
    const pending = Array.from({ length: 6 }, (_, index) =>
      fetchModelInfo(
        `model-${index}`,
        "ollama",
        index === 4 ? cancel.signal : undefined
      )
    )
    const settled = Promise.allSettled(pending)
    await vi.waitFor(() => expect(mocks.details).toHaveBeenCalledTimes(4))
    cancel.abort()
    releases.splice(0).forEach((release) => release())
    await vi.waitFor(() => expect(mocks.details).toHaveBeenCalledTimes(5))
    releases.splice(0).forEach((release) => release())
    const result = await settled
    expect(result[4].status).toBe("rejected")
    expect(mocks.resolve).not.toHaveBeenCalledWith("model-4", "ollama")
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(5)
  })

  it("aborts the provider on deadline without starting the fallback", async () => {
    vi.useFakeTimers()
    let fetchSignal: AbortSignal | undefined
    mocks.details.mockImplementation((_model: string, signal: AbortSignal) => {
      fetchSignal = signal
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true
        })
      )
    })
    const result = expect(
      fetchModelInfo("slow", "ollama")
    ).rejects.toMatchObject({ name: "TimeoutError" })
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    expect(fetchSignal?.aborted).toBe(true)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("passes the same signal to the background fallback", async () => {
    mocks.details.mockResolvedValue(null)
    mocks.rpc.mockResolvedValue({
      details: { capabilities: ["tools"] },
      supportsDetails: true,
      providerId: "ollama"
    })
    await fetchModelInfo("fallback", "ollama")
    expect(mocks.rpc).toHaveBeenCalledWith(
      "models.getDetails",
      { model: "fallback", providerId: "ollama" },
      { signal: expect.any(AbortSignal) }
    )
  })
})
