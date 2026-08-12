import type { MigrationDatabase } from "./database"

export const ensureVectorCleanupReceiptsTable = (
  db: MigrationDatabase
): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS vector_cleanup_receipts (
      messageId INTEGER PRIMARY KEY,
      createdAt INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_vector_cleanup_receipts_createdAt
    ON vector_cleanup_receipts(createdAt)
  `)
}
