import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The owner-ready handshake (H2). `createDocument()` resolving proves a
 * document exists, not that anything inside it can serve a query — these
 * cover the difference.
 */

const createDocument = vi.fn(async () => undefined)
const sendMessage = vi.fn()
const getContexts = vi.fn(async () => [] as { documentUrl?: string }[])

const OWNER_CONTEXT = {
  documentUrl: "chrome-extension://test/persistence-host.html?owner=1"
}

/** Absent until the first createDocument call, present afterwards. */
const documentAppearsOnCreate = () => {
  let exists = false
  getContexts.mockImplementation(async () =>
    exists ? [OWNER_CONTEXT] : ([] as { documentUrl?: string }[])
  )
  createDocument.mockImplementation(async () => {
    exists = true
    return undefined
  })
  return {
    remove: () => {
      exists = false
    }
  }
}

const loadOwner = async () => {
  vi.resetModules()
  return import("../chromium-owner")
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(chrome.runtime, {
    getContexts,
    sendMessage,
    onMessage: { addListener: vi.fn() }
  })
  ;(chrome as unknown as { offscreen: unknown }).offscreen = { createDocument }
  documentAppearsOnCreate()
  sendMessage.mockResolvedValue({ ok: true, result: "pong" })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("persistence owner readiness", () => {
  it("keeps asking until the freshly created owner answers", async () => {
    sendMessage
      .mockRejectedValueOnce(
        new Error(
          "Could not establish connection. Receiving end does not exist"
        )
      )
      .mockRejectedValueOnce(
        new Error(
          "Could not establish connection. Receiving end does not exist"
        )
      )
      .mockResolvedValue({ ok: true, result: "pong" })

    const { ensurePersistenceOwnerReady } = await loadOwner()
    await ensurePersistenceOwnerReady()

    expect(createDocument).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledTimes(3)
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "persistence-rpc",
      request: { op: "ping" }
    })
  })

  it("does not call an existing document ready when it never answers", async () => {
    vi.useFakeTimers()
    sendMessage.mockRejectedValue(new Error("Receiving end does not exist"))

    const { ensurePersistenceOwnerReady } = await loadOwner()
    const ready = ensurePersistenceOwnerReady()
    const rejection = expect(ready).rejects.toThrow(
      /Persistence owner is not ready/
    )
    await vi.advanceTimersByTimeAsync(20_000)
    await rejection
  })

  it("coalesces concurrent callers into one document and one handshake", async () => {
    const { ensurePersistenceOwnerReady } = await loadOwner()

    await Promise.all([
      ensurePersistenceOwnerReady(),
      ensurePersistenceOwnerReady(),
      ensurePersistenceOwnerReady()
    ])

    expect(createDocument).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("caches the proof but not the failure", async () => {
    vi.useFakeTimers()
    sendMessage.mockRejectedValue(new Error("Receiving end does not exist"))

    const { ensurePersistenceOwnerReady } = await loadOwner()
    const failing = ensurePersistenceOwnerReady()
    const rejection = expect(failing).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(20_000)
    await rejection

    sendMessage.mockReset()
    sendMessage.mockResolvedValue({ ok: true, result: "pong" })
    vi.useRealTimers()

    await ensurePersistenceOwnerReady()
    await ensurePersistenceOwnerReady()

    // The retry after the cleared failure, then nothing: a proven owner is
    // asked once, not once per caller.
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("re-proves an owner that had to be recreated", async () => {
    const owner = documentAppearsOnCreate()
    const { ensurePersistenceOwnerReady } = await loadOwner()

    await ensurePersistenceOwnerReady()
    owner.remove()
    await ensurePersistenceOwnerReady()

    expect(createDocument).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it("reports an owner that answers with a failure", async () => {
    vi.useFakeTimers()
    sendMessage.mockResolvedValue({ ok: false, error: "worker never started" })

    const { ensurePersistenceOwnerReady } = await loadOwner()
    const ready = ensurePersistenceOwnerReady()
    const rejection = expect(ready).rejects.toThrow(/worker never started/)
    await vi.advanceTimersByTimeAsync(20_000)
    await rejection
  })
})
