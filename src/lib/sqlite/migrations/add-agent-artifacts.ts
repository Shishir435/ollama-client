import type { MigrationDatabase } from "./database"

/** Run-owned blobs and non-replayable upload intents; idempotent forward migration. */
export const ensureAgentArtifacts = (db: MigrationDatabase): void => {
  db.run(`CREATE TABLE IF NOT EXISTS agent_artifacts (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  metadata TEXT NOT NULL,
  bytes BLOB NOT NULL,
  expiresAt INTEGER NOT NULL,
  FOREIGN KEY(runId) REFERENCES agent_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_run ON agent_artifacts(runId);
CREATE TABLE IF NOT EXISTS agent_artifact_uploads (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  artifactId TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('claimed', 'completed', 'uncertain')),
  FOREIGN KEY(runId) REFERENCES agent_runs(id) ON DELETE CASCADE
);
`)
}
