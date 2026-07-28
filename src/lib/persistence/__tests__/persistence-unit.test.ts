import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  invalidateBackendCache,
  markOpfsBackend,
  readPersistenceBackend
} from "../backend"
import { describeWorkerError } from "../owner-host"
import {
  decodeBind,
  decodeRows,
  decodeValue,
  encodeBind,
  encodeRows,
  encodeValue
} from "../protocol"

describe("persistence blob codec", () => {
  it("round-trips Uint8Array binds through JSON", () => {
    const bytes = Uint8Array.from([0, 1, 255, 128])
    const bind = ["text", 42, null, bytes]
    const wire = JSON.parse(JSON.stringify(encodeBind(bind)))
    const decoded = decodeBind(wire)
    expect(decoded?.[0]).toBe("text")
    expect(decoded?.[1]).toBe(42)
    expect(decoded?.[2]).toBeNull()
    expect(decoded?.[3]).toEqual(bytes)
  })

  it("round-trips BLOB cells in result rows through JSON", () => {
    const rows = [
      { id: 1, data: Uint8Array.from([9, 8, 7]), name: "a.png" },
      { id: 2, data: null, name: "b.pdf" }
    ]
    const wire = JSON.parse(JSON.stringify(encodeRows(rows)))
    const decoded = decodeRows(wire)
    expect(decoded[0].data).toEqual(Uint8Array.from([9, 8, 7]))
    expect(decoded[0].name).toBe("a.png")
    expect(decoded[1].data).toBeNull()
  })

  it("leaves scalars untouched and never misdetects plain objects", () => {
    expect(encodeValue("x")).toBe("x")
    expect(decodeValue({ bytes: [1, 2] })).toEqual({ bytes: [1, 2] })
    expect(decodeValue({ __persistenceBlob: false, bytes: [1] })).toEqual({
      __persistenceBlob: false,
      bytes: [1]
    })
  })
})

describe("persistence backend marker", () => {
  beforeEach(() => {
    invalidateBackendCache()
    vi.mocked(chrome.storage.local.get as any).mockReset()
    vi.mocked(chrome.storage.local.set as any).mockReset()
    ;(chrome.storage.local.set as any).mockResolvedValue(undefined)
  })

  it("defaults to legacy when no marker exists", async () => {
    ;(chrome.storage.local.get as any).mockResolvedValue({})
    await expect(readPersistenceBackend()).resolves.toBe("legacy")
  })

  it("defaults to legacy when the marker read fails", async () => {
    ;(chrome.storage.local.get as any).mockRejectedValue(
      new Error("storage gone")
    )
    await expect(readPersistenceBackend()).resolves.toBe("legacy")
  })

  it("reads opfs after the migration marks it, and caches", async () => {
    ;(chrome.storage.local.get as any).mockResolvedValue({
      persistence_backend_v1: { backend: "opfs", migratedAt: 1 }
    })
    await expect(readPersistenceBackend()).resolves.toBe("opfs")
    // Cached: no second storage read.
    ;(chrome.storage.local.get as any).mockClear()
    await expect(readPersistenceBackend()).resolves.toBe("opfs")
    expect(chrome.storage.local.get).not.toHaveBeenCalled()
  })

  it("markOpfsBackend persists counts and flips the cache", async () => {
    ;(chrome.storage.local.get as any).mockResolvedValue({})
    await expect(readPersistenceBackend()).resolves.toBe("legacy")

    await markOpfsBackend({ sourceCounts: { sessions: 3, messages: 40 } })
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      persistence_backend_v1: expect.objectContaining({
        backend: "opfs",
        sourceCounts: { sessions: 3, messages: 40 }
      })
    })
    await expect(readPersistenceBackend()).resolves.toBe("opfs")
  })
})

describe("worker error description", () => {
  it("names the message and source location", () => {
    const event = new ErrorEvent("error", {
      message: "Refused to create a worker",
      filename: "http://localhost:3000/src/lib/persistence/chat-db-worker.ts",
      lineno: 12,
      colno: 4
    })

    expect(describeWorkerError(event)).toBe(
      "Persistence worker crashed: Refused to create a worker at http://localhost:3000/src/lib/persistence/chat-db-worker.ts:12:4"
    )
  })

  it("falls back to the thrown error when the event has no message", () => {
    // A worker that throws at runtime carries `error`; one that failed to load
    // carries only `message`, and the old handler discarded both.
    const event = new ErrorEvent("error", {
      message: "",
      error: new Error("boom")
    })

    expect(describeWorkerError(event)).toBe("Persistence worker crashed: boom")
  })

  it("omits the location when the event has no filename", () => {
    const event = new ErrorEvent("error", { message: "opaque failure" })

    expect(describeWorkerError(event)).toBe(
      "Persistence worker crashed: opaque failure"
    )
  })

  it("stays useful for a plain Event", () => {
    expect(describeWorkerError(new Event("error"))).toBe(
      "Persistence worker crashed (no error detail available)"
    )
  })

  it("says so when there is no message at all", () => {
    expect(describeWorkerError(new ErrorEvent("error"))).toBe(
      "Persistence worker crashed: no message"
    )
  })
})
