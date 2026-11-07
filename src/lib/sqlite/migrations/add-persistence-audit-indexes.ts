import type { MigrationDatabase } from "./database"

/** Index child traversal and the interrupted-assistant sweep. */
export const ensurePersistenceAuditIndexes = (db: MigrationDatabase): void => {
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_messages_parentId ON messages(parentId)"
  )
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_messages_incomplete ON messages(done, role)"
  )
}

/**
 * Index the lookup of a turn by the user message it answered.
 *
 * `getContextReceiptForMessage` filters on `userMessageId`, which had no index,
 * so every hit or miss walked the whole table (10 ms at 50k rows).
 */
export const ensureTurnRunMessageIndex = (db: MigrationDatabase): void => {
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_turn_runs_userMessageId ON turn_runs(userMessageId)"
  )
}
