import type { Database } from "sql.js"

import { logger } from "@/lib/logger"

/**
 * Idempotent migration ensuring the `sessions.pinned` column exists. New
 * databases get it from SCHEMA_SQL; databases created before session pinning get
 * the ALTER here. Mirrors the `thinking` column migration: introspect
 * `PRAGMA table_info` rather than relying on sql.js to reject a duplicate ALTER.
 */
export const ensureSessionsPinnedColumn = (db: Database): void => {
  const stmt = db.prepare("PRAGMA table_info(sessions)")
  const columns: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.push(row.name)
  }
  stmt.free()

  if (columns.includes("pinned")) return

  logger.info("Adding `pinned` column to sessions table", "SQLite/migrations")
  db.run("ALTER TABLE sessions ADD COLUMN pinned INTEGER DEFAULT 0")
}
