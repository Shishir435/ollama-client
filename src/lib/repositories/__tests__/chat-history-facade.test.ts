import { beforeEach, describe, expect, it, vi } from "vitest"

// Each backend's surface must be mocked BEFORE importing the facade so
// it picks up the mocked module instances. The mocks just record calls.
vi.mock("../dexie-chat-history", () => ({
  getAllSessionsOrderedByRecency: vi.fn(async () => "dexie:getAllSessions"),
  getAllSessions: vi.fn(async () => []),
  getSession: vi.fn(async () => undefined),
  getLatestSession: vi.fn(async () => undefined),
  addSession: vi.fn(async () => "id"),
  bulkPutSessions: vi.fn(async () => undefined),
  updateSession: vi.fn(async () => 1),
  deleteSessionRow: vi.fn(async () => undefined),
  getMessage: vi.fn(async () => undefined),
  countMessages: vi.fn(async () => 0),
  getAllMessages: vi.fn(async () => []),
  getMessagesPaginated: vi.fn(async () => []),
  getMessagesBySessionOrderedByTimestamp: vi.fn(async () => []),
  getMessagesBySession: vi.fn(async () => []),
  getMessagesBySessionAtTimestamp: vi.fn(async () => []),
  getMessagesByParents: vi.fn(async () => []),
  getRootMessagesForSession: vi.fn(async () => []),
  addMessage: vi.fn(async () => 1),
  updateMessage: vi.fn(async () => 1),
  deleteMessagesBySession: vi.fn(async () => 0),
  bulkDeleteMessages: vi.fn(async () => undefined),
  getFilesByMessageIds: vi.fn(async () => []),
  bulkAddFiles: vi.fn(async () => undefined),
  deleteFilesBySession: vi.fn(async () => 0),
  deleteFilesByMessageIds: vi.fn(async () => 0),
  dropDatabase: vi.fn(async () => undefined)
}))

vi.mock("@/lib/sqlite/db", () => ({
  flushSave: vi.fn(async () => undefined),
  saveDatabase: vi.fn(async () => undefined)
}))

vi.mock("../sqlite-chat-history", () => ({
  getAllSessionsOrderedByRecency: vi.fn(async () => "sqlite:getAllSessions"),
  getAllSessions: vi.fn(async () => []),
  getSession: vi.fn(async () => undefined),
  getLatestSession: vi.fn(async () => undefined),
  addSession: vi.fn(async () => "id"),
  bulkPutSessions: vi.fn(async () => undefined),
  updateSession: vi.fn(async () => 1),
  deleteSessionRow: vi.fn(async () => undefined),
  getMessage: vi.fn(async () => undefined),
  countMessages: vi.fn(async () => 0),
  getAllMessages: vi.fn(async () => []),
  getMessagesPaginated: vi.fn(async () => []),
  getMessagesBySessionOrderedByTimestamp: vi.fn(async () => []),
  getMessagesBySession: vi.fn(async () => []),
  getMessagesBySessionAtTimestamp: vi.fn(async () => []),
  getMessagesByParents: vi.fn(async () => []),
  getRootMessagesForSession: vi.fn(async () => []),
  addMessage: vi.fn(async () => 1),
  updateMessage: vi.fn(async () => 1),
  deleteMessagesBySession: vi.fn(async () => 0),
  bulkDeleteMessages: vi.fn(async () => undefined),
  getFilesByMessageIds: vi.fn(async () => []),
  bulkAddFiles: vi.fn(async () => undefined),
  deleteFilesBySession: vi.fn(async () => 0),
  deleteFilesByMessageIds: vi.fn(async () => 0),
  dropDatabase: vi.fn(async () => undefined),
  isSqliteHealthy: vi.fn(async () => false),
  markSqliteHealthy: vi.fn(async () => undefined)
}))

import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import * as sqliteDb from "@/lib/sqlite/db"

import * as dexieRepo from "../dexie-chat-history"
import * as sqliteRepo from "../sqlite-chat-history"

const storageGet = vi.mocked(plasmoGlobalStorage.get)
const storageSet = vi.mocked(plasmoGlobalStorage.set)
const flushSave = vi.mocked(sqliteDb.flushSave)

const importFreshFacade = async () => {
  // The facade caches its init promise in a module-level singleton.
  // Reset module state between tests so each test starts from a clean
  // backend-resolution flow.
  vi.resetModules()
  return import("../chat-history")
}

beforeEach(() => {
  storageGet.mockReset()
  storageSet.mockReset()
  flushSave.mockReset()
  flushSave.mockResolvedValue(undefined)
  for (const fn of Object.values(dexieRepo)) {
    if (typeof fn === "function") {
      ;(fn as ReturnType<typeof vi.fn>).mockClear()
    }
  }
  for (const fn of Object.values(sqliteRepo)) {
    if (typeof fn === "function") {
      ;(fn as ReturnType<typeof vi.fn>).mockClear()
    }
  }
})

describe("chat-history facade", () => {
  it("defaults to dexie when nothing is persisted", async () => {
    storageGet.mockResolvedValue(undefined)
    const facade = await importFreshFacade()

    await facade.getAllSessionsOrderedByRecency()

    expect(facade.getActiveBackend()).toBe("dexie")
    expect(dexieRepo.getAllSessionsOrderedByRecency).toHaveBeenCalledTimes(1)
    expect(sqliteRepo.getAllSessionsOrderedByRecency).not.toHaveBeenCalled()
  })

  it("uses sqlite when storage already says sqlite", async () => {
    storageGet.mockResolvedValue("sqlite" as never)
    // Parity: neither store outpaces the other => no auto-fallback.
    vi.mocked(dexieRepo.countMessages).mockResolvedValue(0)
    vi.mocked(sqliteRepo.countMessages).mockResolvedValue(0)
    const facade = await importFreshFacade()

    await facade.getAllSessionsOrderedByRecency()

    expect(facade.getActiveBackend()).toBe("sqlite")
    expect(sqliteRepo.getAllSessionsOrderedByRecency).toHaveBeenCalledTimes(1)
    expect(dexieRepo.getAllSessionsOrderedByRecency).not.toHaveBeenCalled()
  })

  it("auto-falls back to dexie when persisted=sqlite but Dexie outpaces SQLite", async () => {
    // This is the user-reported state after importing an older
    // backup: sync storage says "sqlite", but the SQLite blob has
    // ~1 session while Dexie's chat-db has all 54. The facade must
    // route to Dexie so the data appears immediately, without
    // waiting on any migration.
    storageGet.mockResolvedValue("sqlite" as never)
    storageSet.mockResolvedValue(undefined)
    vi.mocked(sqliteRepo.isSqliteHealthy).mockResolvedValue(false)
    vi.mocked(dexieRepo.countMessages).mockResolvedValue(346)
    vi.mocked(sqliteRepo.countMessages).mockResolvedValue(4)
    const facade = await importFreshFacade()

    const result = await facade.getAllSessionsOrderedByRecency()

    expect(facade.getActiveBackend()).toBe("dexie")
    expect(result).toBe("dexie:getAllSessions")
    expect(dexieRepo.getAllSessionsOrderedByRecency).toHaveBeenCalledTimes(1)
    expect(sqliteRepo.getAllSessionsOrderedByRecency).not.toHaveBeenCalled()
    // And the flip is persisted so the next reload also routes to
    // dexie until the user opts back into sqlite.
    expect(storageSet).toHaveBeenCalledWith("chat-history-backend", "dexie")
  })

  it("does NOT fall back when SQLite is at parity or ahead", async () => {
    // At parity with no cookie, the facade backfills the cookie
    // (so future deletion-resurrection is prevented) but does NOT
    // flip the backend.
    storageGet.mockResolvedValue("sqlite" as never)
    vi.mocked(sqliteRepo.isSqliteHealthy).mockResolvedValue(false)
    vi.mocked(dexieRepo.countMessages).mockResolvedValue(346)
    vi.mocked(sqliteRepo.countMessages).mockResolvedValue(346)
    const facade = await importFreshFacade()

    await facade.getAllSessionsOrderedByRecency()

    expect(facade.getActiveBackend()).toBe("sqlite")
    // Backfill: the cookie gets written for pre-existing healthy users.
    expect(sqliteRepo.markSqliteHealthy).toHaveBeenCalledTimes(1)
    // Backend pointer NOT touched.
    expect(storageSet).not.toHaveBeenCalled()
  })

  it("does NOT fall back when Dexie is empty", async () => {
    storageGet.mockResolvedValue("sqlite" as never)
    vi.mocked(sqliteRepo.isSqliteHealthy).mockResolvedValue(false)
    vi.mocked(dexieRepo.countMessages).mockResolvedValue(0)
    vi.mocked(sqliteRepo.countMessages).mockResolvedValue(0)
    const facade = await importFreshFacade()

    await facade.getAllSessionsOrderedByRecency()

    expect(facade.getActiveBackend()).toBe("sqlite")
    expect(storageSet).not.toHaveBeenCalled()
    // Empty-Dexie case: no need to backfill the cookie either,
    // the migration will write it when it runs.
    expect(sqliteRepo.markSqliteHealthy).not.toHaveBeenCalled()
  })

  it("does NOT fall back when SQLite has the health cookie, even if Dexie outpaces it", async () => {
    // Deletion-resurrection guard: a user who legitimately deleted
    // sessions while on SQLite will have sqlite < dexie (because
    // Dexie holds the stale pre-migration snapshot). With the
    // cookie present, the facade trusts SQLite and stays put.
    storageGet.mockResolvedValue("sqlite" as never)
    vi.mocked(sqliteRepo.isSqliteHealthy).mockResolvedValue(true)
    vi.mocked(dexieRepo.countMessages).mockResolvedValue(346)
    vi.mocked(sqliteRepo.countMessages).mockResolvedValue(40)
    const facade = await importFreshFacade()

    await facade.getAllSessionsOrderedByRecency()

    expect(facade.getActiveBackend()).toBe("sqlite")
    expect(storageSet).not.toHaveBeenCalled()
    expect(sqliteRepo.getAllSessionsOrderedByRecency).toHaveBeenCalledTimes(1)
    // No backfill: the cookie already exists.
    expect(sqliteRepo.markSqliteHealthy).not.toHaveBeenCalled()
  })

  it("survives a count() throw and keeps the persisted backend", async () => {
    storageGet.mockResolvedValue("sqlite" as never)
    vi.mocked(sqliteRepo.isSqliteHealthy).mockResolvedValue(false)
    vi.mocked(dexieRepo.countMessages).mockRejectedValue(
      new Error("dexie offline")
    )
    const facade = await importFreshFacade()

    await expect(facade.getAllSessionsOrderedByRecency()).resolves.toBeDefined()
    expect(facade.getActiveBackend()).toBe("sqlite")
  })

  it("kill switch: persisted 'dexie' overrides any in-memory state", async () => {
    storageGet.mockResolvedValue("dexie" as never)
    const facade = await importFreshFacade()

    await facade.getAllSessionsOrderedByRecency()

    expect(facade.getActiveBackend()).toBe("dexie")
    expect(dexieRepo.getAllSessionsOrderedByRecency).toHaveBeenCalledTimes(1)
  })

  it("ignores an invalid persisted value and falls back to dexie", async () => {
    storageGet.mockResolvedValue("postgres" as never)
    const facade = await importFreshFacade()

    await facade.getAllSessionsOrderedByRecency()

    expect(facade.getActiveBackend()).toBe("dexie")
    expect(dexieRepo.getAllSessionsOrderedByRecency).toHaveBeenCalledTimes(1)
  })

  it("setActiveBackend flips routing and persists the choice", async () => {
    storageGet.mockResolvedValue(undefined)
    storageSet.mockResolvedValue(undefined)
    const facade = await importFreshFacade()

    await facade.setActiveBackend("sqlite")
    expect(facade.getActiveBackend()).toBe("sqlite")
    expect(storageSet).toHaveBeenCalledWith("chat-history-backend", "sqlite")

    await facade.getAllSessionsOrderedByRecency()
    expect(sqliteRepo.getAllSessionsOrderedByRecency).toHaveBeenCalled()
    expect(dexieRepo.getAllSessionsOrderedByRecency).not.toHaveBeenCalled()
  })

  it("setActiveBackend('sqlite') flushes SQLite BEFORE persisting the flip", async () => {
    // Regression: if we persist the backend pointer before the in-
    // memory writes are durable, a quick reload reads sqlite as the
    // active backend but finds an empty IndexedDB blob.
    storageGet.mockResolvedValue(undefined)
    storageSet.mockResolvedValue(undefined)
    const facade = await importFreshFacade()

    await facade.setActiveBackend("sqlite")

    expect(flushSave).toHaveBeenCalledTimes(1)
    const flushOrder = flushSave.mock.invocationCallOrder[0]
    const setOrder = storageSet.mock.invocationCallOrder[0]
    expect(flushOrder).toBeLessThan(setOrder)
  })

  it("setActiveBackend('dexie') does NOT flush SQLite", async () => {
    storageGet.mockResolvedValue("sqlite" as never)
    const facade = await importFreshFacade()
    // Resolve the cached init promise on sqlite so the flip to dexie
    // is a real transition.
    await facade.getAllSessionsOrderedByRecency()
    flushSave.mockClear()

    await facade.setActiveBackend("dexie")
    expect(flushSave).not.toHaveBeenCalled()
  })

  it("setActiveBackend aborts the flip if flushSave throws", async () => {
    storageGet.mockResolvedValue(undefined)
    flushSave.mockRejectedValueOnce(new Error("indexeddb full"))
    const facade = await importFreshFacade()

    await expect(facade.setActiveBackend("sqlite")).rejects.toThrow(
      /indexeddb full/i
    )
    expect(facade.getActiveBackend()).toBe("dexie")
    expect(storageSet).not.toHaveBeenCalled()
  })

  it("setActiveBackend with persist=false does not write storage", async () => {
    storageGet.mockResolvedValue(undefined)
    const facade = await importFreshFacade()

    await facade.setActiveBackend("sqlite", { persist: false })
    expect(facade.getActiveBackend()).toBe("sqlite")
    expect(storageSet).not.toHaveBeenCalled()
  })

  it("setting the same backend is a no-op", async () => {
    storageGet.mockResolvedValue(undefined)
    const facade = await importFreshFacade()
    await facade.setActiveBackend("dexie")
    expect(storageSet).not.toHaveBeenCalled()
  })

  it("a storage read error falls back to dexie without throwing", async () => {
    storageGet.mockRejectedValue(new Error("storage offline"))
    const facade = await importFreshFacade()

    await expect(facade.getAllSessionsOrderedByRecency()).resolves.not.toThrow()
    expect(facade.getActiveBackend()).toBe("dexie")
  })

  it("initChatHistoryBackend caches and only reads storage once", async () => {
    storageGet.mockResolvedValue("sqlite" as never)
    const facade = await importFreshFacade()

    const a = await facade.initChatHistoryBackend()
    const b = await facade.initChatHistoryBackend()
    expect(a).toBe("sqlite")
    expect(b).toBe("sqlite")
    expect(storageGet).toHaveBeenCalledTimes(1)
  })
})
