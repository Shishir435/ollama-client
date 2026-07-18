import type { Database } from "sql.js"

import { logger } from "@/lib/logger"

/** Add opaque provider continuation state to persisted assistant messages. */
export const ensureMessagesReplayArtifactColumn = (db: Database): void => {
  const stmt = db.prepare("PRAGMA table_info(messages)")
  const columns: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.push(row.name)
  }
  stmt.free()

  if (columns.includes("replayArtifact")) return

  logger.info(
    "Adding provider replay artifact column to messages",
    "SQLite/migrations"
  )
  db.run("ALTER TABLE messages ADD COLUMN replayArtifact TEXT")
}
