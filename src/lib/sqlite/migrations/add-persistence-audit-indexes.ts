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
