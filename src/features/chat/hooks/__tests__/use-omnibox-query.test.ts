import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const storageMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  watch: vi.fn(),
  unwatch: vi.fn()
}))

const browserMock = vi.hoisted(() => ({
  runtime: {
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() }
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStorageForKey: () => storageMock
}))

vi.mock("@/lib/browser-api", () => ({
  browser: browserMock
}))

import { STORAGE_KEYS } from "@/lib/constants"
import { useOmniboxQuery } from "../use-omnibox-query"

const KEY = STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY

const pending = (query: string, at: number = Date.now()) => ({ query, at })

beforeEach(() => {
  vi.clearAllMocks()
  storageMock.get.mockResolvedValue(undefined)
  storageMock.set.mockResolvedValue(undefined)
  storageMock.remove.mockResolvedValue(undefined)
})

describe("useOmniboxQuery", () => {
  it("does nothing until a model is ready", () => {
    const sendMessage = vi.fn()
    storageMock.get.mockResolvedValue(pending("hello"))

    renderHook(() => useOmniboxQuery({ sendMessage, isModelReady: false }))

    expect(storageMock.get).not.toHaveBeenCalled()
    expect(storageMock.watch).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("consumes a pending query once a model is ready", async () => {
    const sendMessage = vi.fn()
    storageMock.get.mockResolvedValue(pending("explain rag"))

    renderHook(() => useOmniboxQuery({ sendMessage, isModelReady: true }))

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith("explain rag"))
    expect(storageMock.remove).toHaveBeenCalledWith(KEY)
  })

  it("sends a query that arrived before the model hydrated", async () => {
    const sendMessage = vi.fn()
    storageMock.get.mockResolvedValue(pending("deferred query"))

    const { rerender } = renderHook(
      ({ ready }) => useOmniboxQuery({ sendMessage, isModelReady: ready }),
      { initialProps: { ready: false } }
    )

    expect(sendMessage).not.toHaveBeenCalled()

    rerender({ ready: true })

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith("deferred query")
    )
  })

  it("ignores empty pending queries", async () => {
    const sendMessage = vi.fn()
    storageMock.get.mockResolvedValue(pending("   "))

    renderHook(() => useOmniboxQuery({ sendMessage, isModelReady: true }))

    await waitFor(() => expect(storageMock.get).toHaveBeenCalled())
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("discards a stale pending query instead of sending it", async () => {
    const sendMessage = vi.fn()
    // Issued well beyond the TTL (PENDING_QUERY_TTL_MS = 60s).
    storageMock.get.mockResolvedValue(
      pending("old query", Date.now() - 120_000)
    )

    renderHook(() => useOmniboxQuery({ sendMessage, isModelReady: true }))

    await waitFor(() => expect(storageMock.remove).toHaveBeenCalledWith(KEY))
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
