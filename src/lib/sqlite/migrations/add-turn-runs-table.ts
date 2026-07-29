import type { Database } from "sql.js"

/** Add durable ownership rows for submitted chat turns. */
export const ensureTurnRunsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS turn_runs (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      mode TEXT NOT NULL,
      model TEXT NOT NULL,
      providerId TEXT,
      status TEXT NOT NULL,
      request TEXT NOT NULL,
      contextReceipt TEXT,
      userMessageId INTEGER,
      assistantMessageId INTEGER,
      failure TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `)
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_turn_runs_sessionId ON turn_runs(sessionId)"
  )
  db.run("CREATE INDEX IF NOT EXISTS idx_turn_runs_status ON turn_runs(status)")
}
