import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: {
    call: vi.fn()
  }
}))

import { extensionRpcClient } from "@/protocol/extension-client"

import { useEmbeddingModelCheck } from "../use-embedding-model-check"

const mockedCall = vi.mocked(extensionRpcClient.call)

const POLL_INTERVAL_MS = 5_000

const renderCheck = () =>
  renderHook(() =>
    useEmbeddingModelCheck({
      selectedModel: "all-minilm:latest",
      setSelectedModel: vi.fn(),
      applyModelChange: vi.fn(),
      embeddingModels: [],
      resolveProviderForModel: () => "ollama"
    })
  )

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden
  })
}

beforeEach(() => {
  mockedCall.mockReset()
  setHidden(false)
})

describe("useEmbeddingModelCheck polling", () => {
  it("stops polling once the model is present", async () => {
    vi.useFakeTimers()
    mockedCall.mockResolvedValue({ exists: true } as never)

    renderCheck()
    await vi.advanceTimersByTimeAsync(0)
    expect(mockedCall).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4)

    // The model is installed; nothing is left to watch for, so the worker is
    // not woken again.
    expect(mockedCall).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("keeps polling while the model is missing", async () => {
    vi.useFakeTimers()
    mockedCall.mockResolvedValue({ exists: false } as never)

    renderCheck()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)

    expect(mockedCall.mock.calls.length).toBeGreaterThan(1)
    vi.useRealTimers()
  })

  it("skips ticks while the document is hidden", async () => {
    vi.useFakeTimers()
    mockedCall.mockResolvedValue({ exists: false } as never)
    setHidden(true)

    renderCheck()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

    expect(mockedCall).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("checks once when the document becomes visible again", async () => {
    mockedCall.mockResolvedValue({ exists: false } as never)
    setHidden(true)

    renderCheck()
    expect(mockedCall).not.toHaveBeenCalled()

    setHidden(false)
    document.dispatchEvent(new Event("visibilitychange"))

    await waitFor(() => {
      expect(mockedCall).toHaveBeenCalled()
    })
  })

  it("stops polling after unmount", async () => {
    vi.useFakeTimers()
    mockedCall.mockResolvedValue({ exists: false } as never)

    const { unmount } = renderCheck()
    await vi.advanceTimersByTimeAsync(0)
    const callsAtUnmount = mockedCall.mock.calls.length
    unmount()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

    expect(mockedCall.mock.calls.length).toBe(callsAtUnmount)
    vi.useRealTimers()
  })
})
