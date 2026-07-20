import type { Database } from "sql.js"

import { logger } from "@/lib/logger"

/**
 * Idempotent migration ensuring the `messages.updatedAt` column exists. It
 * records when a row was last written; streaming partial-content writes bump
 * it every ~1s, so the interrupted-turn sweep can tell a live turn (recently
 * touched, in any window) from a genuine orphan (stale) inside a single query
 * rather than via a separate, racy liveness check.
 *
 * New databases get the column from SCHEMA_SQL. Older databases get the ALTER
 * here. Pre-existing rows keep a NULL `updatedAt`, which the sweep treats as
 * stale (safe: those rows predate the streaming-write bump).
 */
export const ensureMessagesUpdatedAtColumn = (db: Database): void => {
  const stmt = db.prepare("PRAGMA table_info(messages)")
  const columns: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.push(row.name)
  }
  stmt.free()

  if (columns.includes("updatedAt")) return

  logger.info(
    "Adding `updatedAt` column to messages table",
    "SQLite/migrations"
  )
  db.run("ALTER TABLE messages ADD COLUMN updatedAt INTEGER")
}
