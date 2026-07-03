import type { Database } from "sql.js"
import { logger } from "@/lib/logger"

export const ensureSessionsTagsColumn = (db: Database): void => {
  const stmt = db.prepare("PRAGMA table_info(sessions)")
  const columns: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.push(row.name)
  }
  stmt.free()

  if (columns.includes("tags")) return
  logger.info("Adding `tags` column to sessions table", "SQLite/migrations")
  db.run("ALTER TABLE sessions ADD COLUMN tags TEXT")
}
