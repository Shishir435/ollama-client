import { useEffect, useRef } from "react"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { useToast } from "@/hooks/use-toast"
import { db as dexieDb } from "@/lib/db"
import { logger } from "@/lib/logger"
import {
  getMigrationStatus,
  type MigrationProgress,
  runDexieToSQLiteMigration
} from "@/lib/migration/dexie-to-sqlite"
import {
  getActiveBackend,
  initChatHistoryBackend,
  setActiveBackend
} from "@/lib/repositories/chat-history"
import * as sqliteRepo from "@/lib/repositories/sqlite-chat-history"

/**
 * Mount-time SQLite migration hook.
 *
 * Behavior depending on saved state:
 *
 *   1. `chat-history-backend` is "dexie" (kill-switch active):
 *      Skip migration entirely. Caller stays on Dexie. Logs the
 *      override so anyone reading the console knows why.
 *
 *   2. Migration status is "completed":
 *      No migration work. Flip backend to "sqlite" if it isn't
 *      already (e.g. fresh install on a tab that's never been
 *      bootstrapped before).
 *
 *   3. Migration status is anything else ("pending" | "in_progress" |
 *      "failed"):
 *      Run `runDexieToSQLiteMigration`, show progress toast, and on
 *      success flip the backend to "sqlite" and persist that choice.
 *      On failure, leave the backend on Dexie -- user data is safe.
 *
 * The migration is idempotent and resumable, so re-runs are cheap.
 *
 * Split-brain reconcile: `chat-history-backend` and
 * `sqlite_migration_status` live in `chrome.storage.sync`, which
 * replicates across devices/profiles. Combined with the
 * pre-fix flush-debounce race, this produced cases where the
 * "completed" flag was true on a device whose SQLite IndexedDB was
 * effectively empty while Dexie still held the user's real history.
 * Before trusting the completion flag, we cross-check: if Dexie has
 * more messages than SQLite, the flag is lying; we re-run the
 * idempotent migration to bring SQLite up to parity.
 */
export const useSQLiteMigration = () => {
  const { toast, update } = useToast()
  const hasRun = useRef(false)

  useEffect(() => {
    // Only run once per session.
    if (hasRun.current) return
    hasRun.current = true

    const checkAndRunMigration = async () => {
      // Always start by reading the persisted backend so the rest of
      // the app sees the right value before any chat-history read.
      const backendOnStartup = await initChatHistoryBackend()

      // Cross-check: even when the persisted flags say "we're done",
      // verify that SQLite actually has at least as much chat data as
      // Dexie. If not, treat the migration as incomplete on this
      // device and re-run it.
      const detectDexieSqliteSplit = async (): Promise<boolean> => {
        try {
          const dexieCount = await dexieDb.messages.count()
          if (dexieCount === 0) return false
          const sqliteCount = await sqliteRepo.countMessages()
          if (dexieCount > sqliteCount) {
            logger.warn(
              `Dexie/SQLite split detected: dexie=${dexieCount} msg(s) > sqlite=${sqliteCount}; re-running migration`,
              "Migration"
            )
            return true
          }
          return false
        } catch (e) {
          logger.warn(
            "Split-brain check failed; proceeding as-is",
            "Migration",
            {
              error: e
            }
          )
          return false
        }
      }

      if (backendOnStartup === "dexie") {
        // Either we've never migrated, or someone flipped the kill
        // switch back to "dexie". Status decides which.
        try {
          const status = await getMigrationStatus()

          if (
            status.status === "completed" &&
            !(await detectDexieSqliteSplit())
          ) {
            // Migration ran in a previous session but the backend
            // pointer is missing or has been reset. Flip back to
            // SQLite without re-running.
            logger.info(
              "SQLite migration already completed; activating backend",
              "Migration"
            )
            await setActiveBackend("sqlite")
            return
          }

          // If the status says "completed" but a split was detected,
          // clear the flag so runDexieToSQLiteMigration doesn't
          // immediately return without doing any work.
          if (status.status === "completed") {
            logger.info(
              "Clearing stale completed flag to re-run migration after split",
              "Migration"
            )
            const { plasmoGlobalStorage } = await import(
              "@/lib/plasmo-global-storage"
            )
            await plasmoGlobalStorage.set("sqlite_migration_status", "pending")
          }

          const { dismiss: dismissProgress, id } = toast({
            title: "Upgrading database",
            description: "Migrating to SQLite for better performance...",
            duration: Number.POSITIVE_INFINITY
          })

          logger.info("Starting automatic SQLite migration", "Migration")

          await runDexieToSQLiteMigration((progress: MigrationProgress) => {
            update(id, {
              title: "Upgrading database",
              description: `Progress: ${progress.completedSessions}/${progress.totalSessions} sessions`,
              duration: Number.POSITIVE_INFINITY
            })
          })

          dismissProgress()
          toast({
            title: "Database upgraded",
            description: "Your data is now backed by SQLite.",
            duration: 5000
          })

          await setActiveBackend("sqlite")
          logger.info(
            "Automatic SQLite migration completed; backend flipped",
            "Migration"
          )
        } catch (error) {
          logger.error("Automatic migration failed", "Migration", { error })
          toast({
            title: "Database upgrade failed",
            description:
              "We will keep using the previous storage. Your data is safe.",
            variant: "destructive",
            duration: 10000
          })
          // Leave activeBackend on dexie — caller stays on the legacy
          // path until the next attempt succeeds.
        }
        return
      }

      // backendOnStartup === "sqlite" -- normally nothing to do. But
      // the persisted "we're on SQLite, migration completed" state can
      // be stale on a device that has Dexie data SQLite never absorbed
      // (cross-device sync of the completed flag, or the pre-fix
      // flush-debounce race). Reconcile before trusting it.
      if (await detectDexieSqliteSplit()) {
        try {
          // Force the migration past its own "already completed" early
          // return: the status read here is the same module-level
          // plasmoGlobalStorage the migration consults, so clearing it
          // lets the migration proceed. Note: the migration will
          // re-write "completed" on success.
          const status = await getMigrationStatus()
          logger.info(
            `Re-running SQLite migration to absorb stranded Dexie data (status was ${status.status})`,
            "Migration"
          )

          const { dismiss: dismissProgress, id } = toast({
            title: "Restoring chat history",
            description: "Re-importing messages into SQLite...",
            duration: Number.POSITIVE_INFINITY
          })

          // Clear the completed flag so the migration's early-return
          // gate lets us through. The migration sets it back to
          // "completed" on success.
          const { plasmoGlobalStorage } = await import(
            "@/lib/plasmo-global-storage"
          )
          await plasmoGlobalStorage.set("sqlite_migration_status", "pending")

          await runDexieToSQLiteMigration((progress: MigrationProgress) => {
            update(id, {
              title: "Restoring chat history",
              description: `Progress: ${progress.completedSessions}/${progress.totalSessions} sessions`,
              duration: Number.POSITIVE_INFINITY
            })
          })

          dismissProgress()

          // The chat-session store almost certainly hydrated against
          // the pre-reconcile SQLite (1 stale "yo" session in the
          // reported case). Its `loadSessions` short-circuits on
          // `hydrated`, so the newly-migrated rows won't surface on
          // their own. Force a re-read here.
          try {
            await chatSessionStore.getState().refreshSessions()
            logger.info(
              "Chat session store refreshed after reconcile",
              "Migration"
            )
          } catch (e) {
            logger.warn(
              "Failed to refresh chat-session store after reconcile; user may need to reload",
              "Migration",
              { error: e }
            )
          }

          toast({
            title: "Chat history restored",
            description: "Your sessions are now visible.",
            duration: 5000
          })
        } catch (error) {
          logger.error("Reconcile migration failed", "Migration", { error })
          toast({
            title: "Could not restore older sessions",
            description:
              "Some older sessions could not be re-imported. The kill switch (chat-history-backend = 'dexie') will surface them.",
            variant: "destructive",
            duration: 10000
          })
        }
        return
      }

      logger.info(
        `Chat history backend: ${getActiveBackend()} (persisted)`,
        "Migration"
      )
    }

    checkAndRunMigration()
  }, [toast, update])
}
