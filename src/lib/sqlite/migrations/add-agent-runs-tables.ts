import type { MigrationDatabase } from "./database"

/** Migration 16: isolated durable ownership and bounded evidence for Agent. */
export const ensureAgentRunsTables = (db: MigrationDatabase): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status)"
  )
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      runId TEXT NOT NULL,
      stepId TEXT NOT NULL,
      status TEXT NOT NULL,
      receipt TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(runId) REFERENCES agent_runs(id) ON DELETE CASCADE
    )
  `)
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_agent_steps_runId ON agent_steps(runId, id)"
  )
}
