import type { Database } from "sql.js"

/** Add durable checkpoints for resumable tool-calling turns. */
export const ensureToolLoopRunsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tool_loop_runs (
      requestId TEXT PRIMARY KEY,
      sessionId TEXT,
      model TEXT NOT NULL,
      providerId TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      state TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_tool_loop_runs_sessionId ON tool_loop_runs(sessionId)"
  )
}
