import { logger } from "@/lib/logger"
import type { MigrationDatabase } from "./database"

/**
 * Idempotent migration ensuring `sessions.titleSource` exists. `'manual'`
 * records that the user named the chat, so the first-message auto-title never
 * replaces it; `NULL` (every existing chat) means the title is still the
 * automatic one.
 */
export const ensureSessionsTitleSourceColumn = (
  db: MigrationDatabase
): void => {
  const stmt = db.prepare("PRAGMA table_info(sessions)")
  const columns: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.push(row.name)
  }
  stmt.free()

  if (columns.includes("titleSource")) return
  logger.info(
    "Adding `titleSource` column to sessions table",
    "SQLite/migrations"
  )
  db.run("ALTER TABLE sessions ADD COLUMN titleSource TEXT")
}
