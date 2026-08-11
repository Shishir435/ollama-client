import { logger } from "@/lib/logger"
import type { MigrationDatabase } from "./database"

/**
 * Idempotent migration that ensures the `messages.thinking` column
 * exists. New databases get it from SCHEMA_SQL. Older databases
 * created before the column was added get the ALTER TABLE here.
 *
 * Uses PRAGMA table_info instead of a try/catch around ALTER TABLE:
 * introspecting the column list states the precondition, where catching a
 * duplicate-column error depends on how the binding surfaces it.
 */
export const ensureMessagesThinkingColumn = (db: MigrationDatabase): void => {
  const stmt = db.prepare("PRAGMA table_info(messages)")
  const columns: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.push(row.name)
  }
  stmt.free()

  if (columns.includes("thinking")) return

  logger.info("Adding `thinking` column to messages table", "SQLite/migrations")
  db.run("ALTER TABLE messages ADD COLUMN thinking TEXT")
}
