import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useBrowserBuiltInVisible } from "../use-browser-built-in-visible"

const mocks = vi.hoisted(() => ({ api: vi.fn(), call: vi.fn() }))
vi.mock("@/lib/providers/browser-built-in/api", () => ({
  promptAPI: mocks.api
}))
vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: mocks.call }
}))
afterEach(() => {
  vi.resetAllMocks()
  vi.useRealTimers()
})

describe("optional browser setting visibility", () => {
  it("does not query unsupported browsers", () => {
    mocks.api.mockReturnValue(undefined)
    const { result } = renderHook(useBrowserBuiltInVisible)
    expect(result.current).toBe(false)
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it.each(["available", "downloadable", "downloading", "unavailable"])(
    "uses host evidence for %s",
    async (availability) => {
      mocks.api.mockReturnValue({})
      mocks.call.mockResolvedValue({ availability, enabled: false })
      const { result } = renderHook(useBrowserBuiltInVisible)
      await waitFor(() => expect(mocks.call).toHaveBeenCalledOnce())
      await waitFor(() =>
        expect(result.current).toBe(availability !== "unavailable")
      )
    }
  )

  it("removes an unavailable disabled control after a later status reply", async () => {
    mocks.api.mockReturnValue({})
    mocks.call.mockResolvedValue({ availability: "available", enabled: false })
    vi.useFakeTimers()
    const { result, unmount } = renderHook(useBrowserBuiltInVisible)
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current).toBe(true)
    const signal = mocks.call.mock.calls[0][2].signal as AbortSignal
    mocks.call.mockResolvedValue({
      availability: "unavailable",
      enabled: false
    })
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(false)
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
