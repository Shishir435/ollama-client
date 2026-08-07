import { logger } from "@/lib/logger"
import type { MigrationDatabase } from "./database"

/**
 * Idempotent migration ensuring the `sessions.systemPrompt` column exists (the
 * per-chat system prompt override). New databases get it from SCHEMA_SQL; older
 * ones get the ALTER here. Mirrors the other column migrations: introspect
 * `PRAGMA table_info` rather than relying on a duplicate ALTER being rejected.
 */
export const ensureSessionsSystemPromptColumn = (
  db: MigrationDatabase
): void => {
  const stmt = db.prepare("PRAGMA table_info(sessions)")
  const columns: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.push(row.name)
  }
  stmt.free()

  if (columns.includes("systemPrompt")) return

  logger.info(
    "Adding `systemPrompt` column to sessions table",
    "SQLite/migrations"
  )
  db.run("ALTER TABLE sessions ADD COLUMN systemPrompt TEXT")
}
