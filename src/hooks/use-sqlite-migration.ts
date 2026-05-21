import { useEffect, useRef } from "react"
import { useToast } from "@/hooks/use-toast"
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
 */
export const useSQLiteMigration = () => {
  const { toast } = useToast()
  const hasRun = useRef(false)

  useEffect(() => {
    // Only run once per session.
    if (hasRun.current) return
    hasRun.current = true

    const checkAndRunMigration = async () => {
      // Always start by reading the persisted backend so the rest of
      // the app sees the right value before any chat-history read.
      const backendOnStartup = await initChatHistoryBackend()

      if (backendOnStartup === "dexie") {
        // Either we've never migrated, or someone flipped the kill
        // switch back to "dexie". Status decides which.
        try {
          const status = await getMigrationStatus()

          if (status.status === "completed") {
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

          const { dismiss } = toast({
            title: "Upgrading database",
            description: "Migrating to SQLite for better performance...",
            duration: Number.POSITIVE_INFINITY
          })

          logger.info("Starting automatic SQLite migration", "Migration")

          await runDexieToSQLiteMigration((progress: MigrationProgress) => {
            dismiss()
            toast({
              title: "Upgrading database",
              description: `Progress: ${progress.completedSessions}/${progress.totalSessions} sessions`,
              duration: Number.POSITIVE_INFINITY
            })
          })

          dismiss()
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

      // backendOnStartup === "sqlite" -- nothing to do; getActiveBackend
      // already reports the right value.
      logger.info(
        `Chat history backend: ${getActiveBackend()} (persisted)`,
        "Migration"
      )
    }

    checkAndRunMigration()
  }, [toast])
}
