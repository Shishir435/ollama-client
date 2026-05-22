import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// All transitive deps must be mocked BEFORE importing the hook so it
// picks up the mocked module instances. Keep this list aligned with
// the hook's actual imports.

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(() => ({ dismiss: vi.fn() }))
  })
}))

vi.mock("@/lib/db", () => ({
  db: {
    messages: {
      count: vi.fn(async () => 0)
    }
  }
}))

vi.mock("@/lib/migration/dexie-to-sqlite", () => ({
  getMigrationStatus: vi.fn(async () => ({ status: "pending" })),
  runDexieToSQLiteMigration: vi.fn(async (_onProgress?: unknown) => undefined)
}))

vi.mock("@/lib/repositories/chat-history", () => ({
  initChatHistoryBackend: vi.fn(async () => "dexie"),
  setActiveBackend: vi.fn(async () => undefined),
  getActiveBackend: vi.fn(() => "dexie")
}))

vi.mock("@/lib/repositories/sqlite-chat-history", () => ({
  countMessages: vi.fn(async () => 0)
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  chatSessionStore: {
    getState: vi.fn(() => ({
      refreshSessions: vi.fn(async () => undefined)
    }))
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    set: vi.fn(async () => undefined),
    get: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined)
  }
}))

import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { useSQLiteMigration } from "@/hooks/use-sqlite-migration"
import { db as dexieDb } from "@/lib/db"
import {
  getMigrationStatus,
  runDexieToSQLiteMigration
} from "@/lib/migration/dexie-to-sqlite"
import {
  initChatHistoryBackend,
  setActiveBackend
} from "@/lib/repositories/chat-history"
import * as sqliteRepo from "@/lib/repositories/sqlite-chat-history"

const init = vi.mocked(initChatHistoryBackend)
const setBackend = vi.mocked(setActiveBackend)
const getStatus = vi.mocked(getMigrationStatus)
const runMigration = vi.mocked(runDexieToSQLiteMigration)
const dexieCount = vi.mocked(dexieDb.messages.count)
const sqliteCount = vi.mocked(sqliteRepo.countMessages)

beforeEach(() => {
  init.mockReset()
  setBackend.mockReset().mockResolvedValue(undefined)
  getStatus.mockReset()
  runMigration.mockReset().mockResolvedValue(undefined)
  dexieCount.mockReset()
  sqliteCount.mockReset()
})

describe("useSQLiteMigration", () => {
  it("when backend=dexie and status=completed and Dexie==SQLite: flips to sqlite, skips migration", async () => {
    init.mockResolvedValue("dexie")
    getStatus.mockResolvedValue({ status: "completed" })
    dexieCount.mockResolvedValue(40)
    sqliteCount.mockResolvedValue(40)

    renderHook(() => useSQLiteMigration())

    await waitFor(() => expect(setBackend).toHaveBeenCalledWith("sqlite"))
    expect(runMigration).not.toHaveBeenCalled()
  })

  it("when backend=dexie and status=completed BUT Dexie > SQLite: re-runs migration to catch up", async () => {
    init.mockResolvedValue("dexie")
    getStatus.mockResolvedValue({ status: "completed" })
    dexieCount.mockResolvedValue(346)
    sqliteCount.mockResolvedValue(4)

    renderHook(() => useSQLiteMigration())

    // Migration runs and the backend gets flipped to sqlite afterward.
    await waitFor(() => expect(runMigration).toHaveBeenCalled())
    await waitFor(() => expect(setBackend).toHaveBeenCalledWith("sqlite"))
  })

  it("when backend=sqlite and Dexie > SQLite: reconciles the split by re-running migration", async () => {
    init.mockResolvedValue("sqlite")
    dexieCount.mockResolvedValue(346)
    sqliteCount.mockResolvedValue(4)
    // Hook reads status to log it; pretend completed.
    getStatus.mockResolvedValue({ status: "completed" })

    const refreshSessions = vi.fn(async () => undefined)
    vi.mocked(chatSessionStore.getState).mockReturnValue({
      refreshSessions
    } as unknown as ReturnType<typeof chatSessionStore.getState>)

    renderHook(() => useSQLiteMigration())

    await waitFor(() => expect(runMigration).toHaveBeenCalled())
    // After the reconcile lands new rows in SQLite, the chat-session
    // store -- almost certainly hydrated against the pre-reconcile
    // empty/stale SQLite -- must be force-refreshed; otherwise its
    // own loadSessions short-circuits on `hydrated` and the new rows
    // never surface in the UI.
    await waitFor(() => expect(refreshSessions).toHaveBeenCalled())
  })

  it("when backend=sqlite and Dexie <= SQLite: no reconcile, no migration", async () => {
    init.mockResolvedValue("sqlite")
    dexieCount.mockResolvedValue(40)
    sqliteCount.mockResolvedValue(40)

    renderHook(() => useSQLiteMigration())

    // Give the effect a chance to settle.
    await new Promise((r) => setTimeout(r, 0))
    expect(runMigration).not.toHaveBeenCalled()
    expect(setBackend).not.toHaveBeenCalled()
  })

  it("when backend=dexie and status=pending: runs migration as usual", async () => {
    init.mockResolvedValue("dexie")
    getStatus.mockResolvedValue({ status: "pending" })
    dexieCount.mockResolvedValue(40)
    sqliteCount.mockResolvedValue(0)

    renderHook(() => useSQLiteMigration())

    await waitFor(() => expect(runMigration).toHaveBeenCalled())
    await waitFor(() => expect(setBackend).toHaveBeenCalledWith("sqlite"))
  })

  it("when Dexie is empty: split check is a no-op even if SQLite is empty too", async () => {
    init.mockResolvedValue("sqlite")
    dexieCount.mockResolvedValue(0)
    sqliteCount.mockResolvedValue(0)

    renderHook(() => useSQLiteMigration())

    await new Promise((r) => setTimeout(r, 0))
    expect(runMigration).not.toHaveBeenCalled()
  })
})
