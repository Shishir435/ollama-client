import type { MigrationDatabase } from "./database"

export const ensureIngestionRunsTable = (db: MigrationDatabase): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS ingestion_runs (
      id TEXT PRIMARY KEY,
      fileId TEXT NOT NULL,
      knowledgeSetId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      autoEmbed INTEGER NOT NULL,
      failure TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(status)"
  )
}
