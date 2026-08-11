import { logger } from "@/lib/logger"
import type { MigrationDatabase } from "./database"

/** Persist safe, user-facing terminal error context with assistant messages. */
export const ensureMessagesErrorColumn = (db: MigrationDatabase): void => {
  const stmt = db.prepare("PRAGMA table_info(messages)")
  const columns: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.push(row.name)
  }
  stmt.free()

  if (columns.includes("error")) return

  logger.info("Adding `error` column to messages table", "SQLite/migrations")
  db.run("ALTER TABLE messages ADD COLUMN error TEXT")
}
