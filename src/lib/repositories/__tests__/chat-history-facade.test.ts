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
  dropDatabase: vi.fn(async () => undefined)
}))

import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import * as dexieRepo from "../dexie-chat-history"
import * as sqliteRepo from "../sqlite-chat-history"

const storageGet = vi.mocked(plasmoGlobalStorage.get)
const storageSet = vi.mocked(plasmoGlobalStorage.set)

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
    const facade = await importFreshFacade()

    await facade.getAllSessionsOrderedByRecency()

    expect(facade.getActiveBackend()).toBe("sqlite")
    expect(sqliteRepo.getAllSessionsOrderedByRecency).toHaveBeenCalledTimes(1)
    expect(dexieRepo.getAllSessionsOrderedByRecency).not.toHaveBeenCalled()
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
