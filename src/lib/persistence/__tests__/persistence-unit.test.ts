import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  invalidateBackendCache,
  markOpfsBackend,
  readPersistenceBackend
} from "../backend"
import { describeWorkerError, ensureMigrated } from "../owner-host"

import {
  decodeBind,
  decodeRows,
  decodeValue,
  encodeBind,
  encodeRows,
  encodeValue
} from "../protocol"

const legacyBlob = vi.hoisted(() => ({
  readLegacyBlobBytes: vi.fn(),
  countLegacyRows: vi.fn()
}))
vi.mock("../legacy-blob-reader", () => legacyBlob)

/**
 * Stands in for the chat-db worker: answers any request with an id, ignores the
 * id-less wasm init message. The host under test only needs a reply to `ping`.
 */
class StubWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessageerror: ((event: unknown) => void) | null = null

  postMessage(payload: { id?: number }) {
    if (typeof payload.id !== "number") return
    const { id } = payload
    queueMicrotask(() => {
      this.onmessage?.({ data: { id, ok: true, result: "pong" } })
    })
  }

  terminate() {}
}

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

describe("first boot with no legacy blob", () => {
  /*
   * Direct upgrades are supported from 0.6.0 through the sql.js blob introduced
   * there. A profile with only the older Dexie `ChatDatabase` — written before
   * 0.6.0, or inherited but never copied into sql.js — is outside that support
   * contract. There is no sql.js blob to import and, by decision, no Dexie
   * reader: such a profile starts clean.
   *
   * What must not happen is a *failed* migration. `ensureMigrated` rejecting
   * would leave the marker on "legacy", so every boot would retry, the sql.js
   * path would stay live, and chat writes would land somewhere the OPFS owner is
   * not reading. "Nothing to migrate" has to stay a success.
   */
  beforeEach(() => {
    invalidateBackendCache()
    vi.mocked(chrome.storage.local.get as any).mockReset()
    vi.mocked(chrome.storage.local.set as any).mockReset()
    ;(chrome.storage.local.get as any).mockResolvedValue({})
    ;(chrome.storage.local.set as any).mockResolvedValue(undefined)
    legacyBlob.readLegacyBlobBytes.mockResolvedValue(null)
    legacyBlob.countLegacyRows.mockReset()
    vi.stubGlobal("Worker", StubWorker)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
      })
    )
  })

  it("initializes the OPFS backend fresh and ignores leftover Dexie data", async () => {
    // Leftovers from the pre-SQLite era, deliberately not read.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("ChatDatabase", 2)
      request.onupgradeneeded = () => {
        request.result.createObjectStore("sessions", { keyPath: "id" })
      }
      request.onsuccess = () => {
        const database = request.result
        const store = database
          .transaction(["sessions"], "readwrite")
          .objectStore("sessions")
        store.put({ id: "old-session", title: "From 0.6.3" })
        database.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })

    await expect(ensureMigrated()).resolves.toBeUndefined()

    // Flipped to opfs with no source counts: nothing was imported, and the
    // absence of counts is what says so.
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      persistence_backend_v1: expect.objectContaining({ backend: "opfs" })
    })
    const marker = vi.mocked(chrome.storage.local.set as any).mock.calls[0][0]
      .persistence_backend_v1
    expect(marker.sourceCounts).toBeUndefined()
    // No blob means no verification pass to run.
    expect(legacyBlob.countLegacyRows).not.toHaveBeenCalled()
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
