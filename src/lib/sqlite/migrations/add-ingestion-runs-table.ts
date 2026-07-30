import type { Database } from "sql.js"

export const ensureIngestionRunsTable = (db: Database): void => {
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
