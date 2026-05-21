import type { Database } from "sql.js"

import { logger } from "@/lib/logger"

/**
 * Idempotent migration that ensures the `messages.thinking` column
 * exists. New databases get it from SCHEMA_SQL. Older databases
 * created before the column was added get the ALTER TABLE here.
 *
 * Uses PRAGMA table_info instead of a try/catch around ALTER TABLE
 * because sql.js doesn't reject the statement reliably — checking
 * the column list up front is the cleaner approach.
 */
export const ensureMessagesThinkingColumn = (db: Database): void => {
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
