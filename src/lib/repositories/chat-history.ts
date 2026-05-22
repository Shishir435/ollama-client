import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { flushSave } from "@/lib/sqlite/db"

import * as dexieRepo from "./dexie-chat-history"
import * as sqliteRepo from "./sqlite-chat-history"

/**
 * Runtime-switchable chat-history repository.
 *
 * Both `dexie-chat-history.ts` and `sqlite-chat-history.ts` export the
 * same 26-function surface. This module routes each call to one or
 * the other based on `activeBackend`:
 *
 *   - "dexie"  -- IndexedDB via Dexie. The legacy live store.
 *   - "sqlite" -- sql.js (SQLite in WebAssembly) persisted to IndexedDB.
 *
 * Switching rules:
 *   1. Default at module load is "dexie" so the first frame of a fresh
 *      page works against the still-live store even before the
 *      migration hook has finished initializing.
 *   2. `initChatHistoryBackend()` reads STORAGE_KEYS.CHAT_HISTORY.BACKEND
 *      from extension storage and flips to whatever was last persisted.
 *      Called at app start.
 *   3. `setActiveBackend("sqlite")` is called by `useSQLiteMigration`
 *      after `runDexieToSQLiteMigration` reports success. It also
 *      persists the choice so subsequent loads start on SQLite.
 *   4. The user (or a developer) can override by writing
 *      STORAGE_KEYS.CHAT_HISTORY.BACKEND = "dexie" in extension
 *      storage and reloading. This is the kill switch.
 *
 * The Dexie code paths are NOT deleted in this commit. They stay as a
 * frozen-in-time snapshot for 1-2 weeks while we collect telemetry on
 * the SQLite migration. A follow-up branch removes Dexie once the
 * migration has shown to be reliable in the wild.
 */

export type ChatHistoryBackend = "dexie" | "sqlite"

const STORAGE_KEY = STORAGE_KEYS.CHAT_HISTORY.BACKEND

let activeBackend: ChatHistoryBackend = "dexie"
let initPromise: Promise<ChatHistoryBackend> | null = null

export const getActiveBackend = (): ChatHistoryBackend => activeBackend

const isValidBackend = (value: unknown): value is ChatHistoryBackend =>
  value === "dexie" || value === "sqlite"

/**
 * Auto-fallback to Dexie when the persisted backend says "sqlite"
 * but SQLite is sparser than Dexie. This happens when:
 *
 *   - The original migration ran while in-memory SQLite never got
 *     flushed to IndexedDB (the pre-`flushSave` race).
 *   - chrome.storage.sync replicated a "completed" flag and a
 *     `chat-history-backend = sqlite` pointer from another device
 *     to this one, where Dexie still holds the user's real history.
 *   - A backup zip is imported that captures the above state.
 *
 * The user's data is still in Dexie's `ChatDatabase` IndexedDB.
 * Flipping the routing pointer back to "dexie" makes it visible
 * again immediately, no migration race involved. We also persist
 * the flip so subsequent loads stay on Dexie until the user (or a
 * follow-up migration) deliberately moves them back to SQLite.
 *
 * Note: a faulty SQLite that's *equal in count* to Dexie -- e.g.
 * 0 == 0 on a fresh install -- is NOT flipped. The check only
 * triggers when Dexie strictly outpaces SQLite, which is a one-way
 * state in the cutover window (no path deletes from one without
 * deleting from the other).
 */
const reconcileSplitBrain = async (): Promise<void> => {
  if (activeBackend !== "sqlite") return
  try {
    // If SQLite has self-identified as the source of truth (cookie
    // written by a successful, flushed migration), trust it
    // unconditionally. This prevents the "deletion-resurrection"
    // false positive: a user who legitimately deletes sessions on
    // SQLite would otherwise leave Dexie's stale snapshot strictly
    // greater than SQLite, tripping the auto-fallback below and
    // resurrecting the deleted sessions in the UI on next boot.
    if (await sqliteRepo.isSqliteHealthy()) return

    const dexieCount = await dexieRepo.countMessages()
    if (dexieCount === 0) {
      // SQLite isn't yet self-identified as healthy, but there's no
      // Dexie data to compare against either. Nothing to do here --
      // the migration hook will write the cookie if it runs.
      return
    }
    const sqliteCount = await sqliteRepo.countMessages()

    if (dexieCount <= sqliteCount) {
      // SQLite is at parity (or ahead). This is the state of a
      // healthy user who migrated with old code (no cookie yet) and
      // didn't lose data. Backfill the cookie so future deletions
      // can't false-positive the fallback.
      try {
        await sqliteRepo.markSqliteHealthy()
        // Best-effort flush; if it fails the next migration write
        // will trigger the auto-save anyway.
        const { flushSave: flush } = await import("@/lib/sqlite/db")
        await flush().catch(() => undefined)
        logger.info(
          `SQLite backfilled as healthy (dexie=${dexieCount}, sqlite=${sqliteCount})`,
          "ChatHistoryFacade"
        )
      } catch (e) {
        logger.warn(
          "Failed to backfill SQLite health cookie; will retry on next boot",
          "ChatHistoryFacade",
          { error: e }
        )
      }
      return
    }

    // True split: Dexie > SQLite AND no health cookie. Fall back.
    logger.warn(
      `Chat-history split detected (dexie=${dexieCount} msg > sqlite=${sqliteCount}); auto-falling back to dexie`,
      "ChatHistoryFacade"
    )
    activeBackend = "dexie"
    try {
      await plasmoGlobalStorage.set(STORAGE_KEY, "dexie")
    } catch (e) {
      logger.warn(
        "Failed to persist dexie fallback; reads will still route correctly this session",
        "ChatHistoryFacade",
        { error: e }
      )
    }
  } catch (error) {
    // If either count throws, leave the persisted backend alone --
    // better to potentially show empty UI than to silently corrupt
    // routing on a transient init failure.
    logger.warn(
      "Split-brain reconcile failed; routing against persisted backend",
      "ChatHistoryFacade",
      { error }
    )
  }
}

const loadPersistedBackend = async (): Promise<ChatHistoryBackend> => {
  try {
    const stored = await plasmoGlobalStorage.get<string>(STORAGE_KEY)
    if (isValidBackend(stored)) {
      activeBackend = stored
    }
  } catch (error) {
    logger.warn(
      "Failed to read chat history backend; defaulting to dexie",
      "ChatHistoryFacade",
      { error }
    )
  }
  // Reconcile BEFORE returning so every facade caller that awaits
  // `awaitBackend()` sees the corrected routing.
  await reconcileSplitBrain()
  return activeBackend
}

/**
 * Read the persisted backend choice. Idempotent and cached: subsequent
 * calls return the same resolved promise so we only hit storage once
 * per JS context.
 *
 * Every facade call awaits this implicitly via `awaitBackend()`, so
 * callers don't need to call it manually. It is also exposed as a
 * public name (`initChatHistoryBackend`) for callers (e.g. the
 * SQLite-migration hook) that want to log or branch on the resolved
 * backend at startup.
 */
export const initChatHistoryBackend = (): Promise<ChatHistoryBackend> => {
  if (!initPromise) initPromise = loadPersistedBackend()
  return initPromise
}

const awaitBackend = (): Promise<void> =>
  initChatHistoryBackend().then(() => undefined)

export const setActiveBackend = async (
  backend: ChatHistoryBackend,
  { persist = true }: { persist?: boolean } = {}
): Promise<void> => {
  // Ensure init has run so we don't race with a pending load that would
  // immediately overwrite us.
  await awaitBackend()
  if (activeBackend === backend) return

  // When flipping TO sqlite, force-flush any pending in-memory writes
  // to IndexedDB before persisting the backend pointer. Otherwise the
  // persisted pointer can outlive the data: on the next reload the
  // facade routes reads to an empty SQLite blob. Belt-and-suspenders
  // on top of the migration's own flush; this also covers any future
  // callers that don't go through the migration path.
  if (backend === "sqlite") {
    try {
      await flushSave()
    } catch (error) {
      logger.warn(
        "Failed to flush SQLite before backend flip; aborting flip",
        "ChatHistoryFacade",
        { error }
      )
      throw error
    }
  }

  activeBackend = backend
  logger.info(`Chat history backend set to ${backend}`, "ChatHistoryFacade")
  if (persist) {
    try {
      await plasmoGlobalStorage.set(STORAGE_KEY, backend)
    } catch (error) {
      logger.warn(
        "Failed to persist chat history backend selection",
        "ChatHistoryFacade",
        { error }
      )
    }
  }
}

const repo = () => (activeBackend === "sqlite" ? sqliteRepo : dexieRepo)

// Every exported function awaits `awaitBackend()` before dispatching
// to the chosen repo. The cached init promise means the wait is free
// after the first call in a given JS context. This guarantees we
// never dispatch against a stale `activeBackend` even if the caller
// forgot to bootstrap the migration hook (e.g. options page).

// ----- Sessions ------------------------------------------------------------

export const getAllSessionsOrderedByRecency: typeof dexieRepo.getAllSessionsOrderedByRecency =
  async (...args) => {
    await awaitBackend()
    return repo().getAllSessionsOrderedByRecency(...args)
  }

export const getAllSessions: typeof dexieRepo.getAllSessions = async (
  ...args
) => {
  await awaitBackend()
  return repo().getAllSessions(...args)
}

export const getSession: typeof dexieRepo.getSession = async (...args) => {
  await awaitBackend()
  return repo().getSession(...args)
}

export const getLatestSession: typeof dexieRepo.getLatestSession = async (
  ...args
) => {
  await awaitBackend()
  return repo().getLatestSession(...args)
}

export const addSession: typeof dexieRepo.addSession = async (...args) => {
  await awaitBackend()
  return repo().addSession(...args)
}

export const bulkPutSessions: typeof dexieRepo.bulkPutSessions = async (
  ...args
) => {
  await awaitBackend()
  return repo().bulkPutSessions(...args)
}

export const updateSession: typeof dexieRepo.updateSession = async (
  ...args
) => {
  await awaitBackend()
  return repo().updateSession(...args)
}

export const deleteSessionRow: typeof dexieRepo.deleteSessionRow = async (
  ...args
) => {
  await awaitBackend()
  return repo().deleteSessionRow(...args)
}

// ----- Messages ------------------------------------------------------------

export const getMessage: typeof dexieRepo.getMessage = async (...args) => {
  await awaitBackend()
  return repo().getMessage(...args)
}

export const countMessages: typeof dexieRepo.countMessages = async (
  ...args
) => {
  await awaitBackend()
  return repo().countMessages(...args)
}

export const getAllMessages: typeof dexieRepo.getAllMessages = async (
  ...args
) => {
  await awaitBackend()
  return repo().getAllMessages(...args)
}

export const getMessagesPaginated: typeof dexieRepo.getMessagesPaginated =
  async (...args) => {
    await awaitBackend()
    return repo().getMessagesPaginated(...args)
  }

export const getMessagesBySessionOrderedByTimestamp: typeof dexieRepo.getMessagesBySessionOrderedByTimestamp =
  async (...args) => {
    await awaitBackend()
    return repo().getMessagesBySessionOrderedByTimestamp(...args)
  }

export const getMessagesBySession: typeof dexieRepo.getMessagesBySession =
  async (...args) => {
    await awaitBackend()
    return repo().getMessagesBySession(...args)
  }

export const getMessagesBySessionAtTimestamp: typeof dexieRepo.getMessagesBySessionAtTimestamp =
  async (...args) => {
    await awaitBackend()
    return repo().getMessagesBySessionAtTimestamp(...args)
  }

export const getMessagesByParents: typeof dexieRepo.getMessagesByParents =
  async (...args) => {
    await awaitBackend()
    return repo().getMessagesByParents(...args)
  }

export const getRootMessagesForSession: typeof dexieRepo.getRootMessagesForSession =
  async (...args) => {
    await awaitBackend()
    return repo().getRootMessagesForSession(...args)
  }

export const addMessage: typeof dexieRepo.addMessage = async (...args) => {
  await awaitBackend()
  return repo().addMessage(...args)
}

export const updateMessage: typeof dexieRepo.updateMessage = async (
  ...args
) => {
  await awaitBackend()
  return repo().updateMessage(...args)
}

export const deleteMessagesBySession: typeof dexieRepo.deleteMessagesBySession =
  async (...args) => {
    await awaitBackend()
    return repo().deleteMessagesBySession(...args)
  }

export const bulkDeleteMessages: typeof dexieRepo.bulkDeleteMessages = async (
  ...args
) => {
  await awaitBackend()
  return repo().bulkDeleteMessages(...args)
}

// ----- Files ---------------------------------------------------------------

export const getFilesByMessageIds: typeof dexieRepo.getFilesByMessageIds =
  async (...args) => {
    await awaitBackend()
    return repo().getFilesByMessageIds(...args)
  }

export const bulkAddFiles: typeof dexieRepo.bulkAddFiles = async (...args) => {
  await awaitBackend()
  return repo().bulkAddFiles(...args)
}

export const deleteFilesBySession: typeof dexieRepo.deleteFilesBySession =
  async (...args) => {
    await awaitBackend()
    return repo().deleteFilesBySession(...args)
  }

export const deleteFilesByMessageIds: typeof dexieRepo.deleteFilesByMessageIds =
  async (...args) => {
    await awaitBackend()
    return repo().deleteFilesByMessageIds(...args)
  }

// ----- Database-level -----------------------------------------------------

/**
 * Drop the *active* backend's database. The other side's data is
 * left alone (e.g. on SQLite, Dexie data is untouched -- intentional
 * during the rollout window, so a rollback can restore from it).
 */
export const dropDatabase: typeof dexieRepo.dropDatabase = async (...args) => {
  await awaitBackend()
  return repo().dropDatabase(...args)
}
