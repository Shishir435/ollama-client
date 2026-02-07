import { db as dexieDb } from "@/lib/db"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { SQLiteChatRepository } from "@/lib/repositories/sqlite-chat-repository"
import { initSQLite } from "@/lib/sqlite/db"

const MIGRATION_STATUS_KEY = "sqlite_migration_status"
const MIGRATION_PROGRESS_KEY = "sqlite_migration_progress"

export interface MigrationProgress {
  totalSessions: number
  completedSessions: number
  currentSessionId: string | null
  lastUpdated: number
}

export interface MigrationStatus {
  status: "pending" | "in_progress" | "completed" | "failed"
  progress?: MigrationProgress
  error?: string
}

/**
 * Background migration from Dexie to SQLite
 * - Idempotent: Can be safely re-run without duplicating data
 * - Resumable: Continues from last completed session if interrupted
 * - Progress tracking: Reports progress for UI notifications
 */
export const runDexieToSQLiteMigration = async (
  onProgress?: (progress: MigrationProgress) => void
): Promise<void> => {
  const status = await plasmoGlobalStorage.get(MIGRATION_STATUS_KEY)
  if (status === "completed") {
    logger.info("Migration already completed", "Migration")
    return
  }

  logger.info("Starting Dexie to SQLite migration...", "Migration")

  try {
    // Initialize SQLite database
    await initSQLite()
    const sqliteRepo = new SQLiteChatRepository()

    // Get all sessions to migrate
    const sessions = await dexieDb.sessions.toArray()
    const totalSessions = sessions.length

    if (totalSessions === 0) {
      logger.info("No sessions to migrate", "Migration")
      await plasmoGlobalStorage.set(MIGRATION_STATUS_KEY, "completed")
      return
    }

    logger.info(`Found ${totalSessions} sessions to migrate`, "Migration")
    await plasmoGlobalStorage.set(MIGRATION_STATUS_KEY, "in_progress")

    // Load previous progress if exists (for resumability)
    const savedProgress = await plasmoGlobalStorage.get(MIGRATION_PROGRESS_KEY)
    let completedSessions = 0
    let startIndex = 0

    if (savedProgress) {
      try {
        const progress = JSON.parse(savedProgress) as MigrationProgress
        completedSessions = progress.completedSessions || 0
        startIndex = completedSessions
        logger.info(
          `Resuming migration from session ${startIndex}/${totalSessions}`,
          "Migration"
        )
      } catch (_e) {
        logger.warn(
          "Failed to parse saved progress, starting fresh",
          "Migration"
        )
      }
    }

    // Migrate sessions
    for (let i = startIndex; i < sessions.length; i++) {
      const session = sessions[i]

      try {
        // 1. Migrate Session (idempotent)
        const existingSession = await sqliteRepo.getSession(session.id)
        if (!existingSession) {
          await sqliteRepo.createSession(session)
          logger.info(`Created session ${session.id}`, "Migration")
        } else {
          logger.info(
            `Session ${session.id} already exists, skipping`,
            "Migration"
          )
        }

        // 2. Migrate Messages (idempotent) and add parentId linking
        const messages = await dexieDb.messages
          .where("sessionId")
          .equals(session.id)
          .sortBy("timestamp") // Sort by timestamp to maintain order

        let migratedMessages = 0
        let prevMessageId: number | null = null
        let lastMessageId: number | null = null

        for (const msg of messages) {
          try {
            // Add parentId to link messages linearly (v2 doesn't have parentId)
            const messageWithParent = {
              ...msg,
              parentId: prevMessageId || undefined
            }

            const messageId = await sqliteRepo.addMessageIfNotExists(
              session.id,
              messageWithParent
            )

            if (messageId !== null) {
              migratedMessages++
              prevMessageId = messageId
              lastMessageId = messageId
            }
          } catch (e) {
            logger.warn(
              `Failed to migrate message ${msg.id} in session ${session.id}`,
              "Migration",
              { error: e }
            )
          }
        }

        if (migratedMessages > 0) {
          logger.info(
            `Migrated ${migratedMessages}/${messages.length} messages for session ${session.id}`,
            "Migration"
          )
        }

        // Set currentLeafId to the last message (for tree navigation)
        if (lastMessageId !== null && !existingSession) {
          try {
            await sqliteRepo.updateSession(session.id, {
              currentLeafId: lastMessageId
            })
            logger.info(
              `Set currentLeafId to ${lastMessageId} for session ${session.id}`,
              "Migration"
            )
          } catch (e) {
            logger.warn(
              `Failed to set currentLeafId for session ${session.id}`,
              "Migration",
              { error: e }
            )
          }
        }

        // 3. Migrate Files (idempotent)
        const files = await dexieDb.files
          .where("sessionId")
          .equals(session.id)
          .toArray()

        let migratedFiles = 0
        for (const file of files) {
          try {
            const inserted = await sqliteRepo.addFileIfNotExists(file)
            if (inserted) {
              migratedFiles++
            }
          } catch (e) {
            logger.warn(
              `Failed to migrate file ${file.fileId} in session ${session.id}`,
              "Migration",
              { error: e }
            )
          }
        }

        if (migratedFiles > 0) {
          logger.info(
            `Migrated ${migratedFiles}/${files.length} files for session ${session.id}`,
            "Migration"
          )
        }

        // Update progress
        completedSessions++
        const progress: MigrationProgress = {
          totalSessions,
          completedSessions,
          currentSessionId: session.id,
          lastUpdated: Date.now()
        }

        // Save progress for resumability
        await plasmoGlobalStorage.set(
          MIGRATION_PROGRESS_KEY,
          JSON.stringify(progress)
        )

        // Report progress to caller (for UI notifications)
        if (onProgress) {
          onProgress(progress)
        }

        logger.info(
          `Migration progress: ${completedSessions}/${totalSessions} sessions completed`,
          "Migration"
        )
      } catch (sessionError) {
        logger.error(`Failed to migrate session ${session.id}`, "Migration", {
          error: sessionError
        })
        // Continue with next session instead of failing entire migration
      }
    }

    // Migration completed successfully
    await plasmoGlobalStorage.set(MIGRATION_STATUS_KEY, "completed")
    await plasmoGlobalStorage.remove(MIGRATION_PROGRESS_KEY)
    logger.info("Migration completed successfully!", "Migration")
  } catch (error) {
    logger.error("Migration failed", "Migration", { error })
    await plasmoGlobalStorage.set(MIGRATION_STATUS_KEY, "failed")
    // Keep progress saved so migration can be resumed
    throw error
  }
}

/**
 * Get current migration status
 */
export const getMigrationStatus = async (): Promise<MigrationStatus> => {
  const status =
    ((await plasmoGlobalStorage.get(
      MIGRATION_STATUS_KEY
    )) as MigrationStatus["status"]) || "pending"
  const progressStr = await plasmoGlobalStorage.get(MIGRATION_PROGRESS_KEY)

  let progress: MigrationProgress | undefined
  if (progressStr) {
    try {
      progress = JSON.parse(progressStr)
    } catch (_e) {
      logger.warn("Failed to parse migration progress", "Migration")
    }
  }

  return {
    status,
    progress
  }
}
