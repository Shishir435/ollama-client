import { useEffect, useRef } from "react"
import { useToast } from "@/hooks/use-toast"
import { logger } from "@/lib/logger"
import {
  getMigrationStatus,
  type MigrationProgress,
  runDexieToSQLiteMigration
} from "@/lib/migration/dexie-to-sqlite"

/**
 * Hook to automatically run SQLite migration on app startup
 * Shows non-blocking toast notifications for migration progress
 */
export const useSQLiteMigration = () => {
  const { toast } = useToast()
  const hasRun = useRef(false)

  useEffect(() => {
    // Only run once per session
    if (hasRun.current) return
    hasRun.current = true

    const checkAndRunMigration = async () => {
      try {
        const status = await getMigrationStatus()

        if (status.status === "completed") {
          logger.info("SQLite migration already completed", "Migration")
          return
        }

        // Show initial toast
        const { dismiss } = toast({
          title: "Upgrading database",
          description: "Migrating to SQLite for better performance...",
          duration: Number.POSITIVE_INFINITY // Keep until we dismiss it
        })

        logger.info("Starting automatic SQLite migration", "Migration")

        // Run migration with progress updates
        await runDexieToSQLiteMigration((progress: MigrationProgress) => {
          // Update toast with progress
          dismiss()
          toast({
            title: "Upgrading database",
            description: `Progress: ${progress.completedSessions}/${progress.totalSessions} sessions`,
            duration: Number.POSITIVE_INFINITY
          })
        })

        // Dismiss progress toast and show completion
        dismiss()
        toast({
          title: "✅ Database upgraded!",
          description: "Your data is now faster and more reliable.",
          duration: 5000
        })

        logger.info(
          "Automatic SQLite migration completed successfully",
          "Migration"
        )
      } catch (error) {
        logger.error("Automatic migration failed", "Migration", { error })
        toast({
          title: "⚠️ Database upgrade failed",
          description:
            "Please check the console for details. Your data is safe.",
          variant: "destructive",
          duration: 10000
        })
      }
    }

    // Run migration in background (non-blocking)
    checkAndRunMigration()
  }, [toast])
}
