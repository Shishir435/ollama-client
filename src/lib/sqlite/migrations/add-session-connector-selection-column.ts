import { logger } from "@/lib/logger"
import type { MigrationDatabase } from "./database"

/**
 * Idempotent migration ensuring `sessions.disabledConnectorIds` exists: a JSON
 * array of the MCP connector ids the user switched off for that chat. It is an
 * exclusion list on purpose — `NULL` (every existing chat, every new one) means
 * "all enabled connectors", which is what chats did before the picker existed,
 * and a connector added later is on for a chat that never opted it out.
 */
export const ensureSessionsConnectorSelectionColumn = (
  db: MigrationDatabase
): void => {
  const stmt = db.prepare("PRAGMA table_info(sessions)")
  const columns: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.push(row.name)
  }
  stmt.free()

  if (columns.includes("disabledConnectorIds")) return
  logger.info(
    "Adding `disabledConnectorIds` column to sessions table",
    "SQLite/migrations"
  )
  db.run("ALTER TABLE sessions ADD COLUMN disabledConnectorIds TEXT")
}
