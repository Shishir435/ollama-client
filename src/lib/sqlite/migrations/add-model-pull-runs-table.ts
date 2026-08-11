import type { MigrationDatabase } from "./database"

export const ensureModelPullRunsTable = (db: MigrationDatabase): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS model_pull_runs (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      providerId TEXT,
      status TEXT NOT NULL,
      statusText TEXT,
      progress INTEGER,
      failure TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_model_pull_runs_status ON model_pull_runs(status)"
  )
}
