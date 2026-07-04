import type { Database } from "sql.js"

/** Add durable, user-resumable browser-agent runs. */
export const ensureAgentRunsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      status TEXT NOT NULL,
      state TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      completedAt INTEGER,
      FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_agent_runs_sessionId ON agent_runs(sessionId)"
  )
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status)"
  )
}
