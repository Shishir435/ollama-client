export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  modelId TEXT,
  currentLeafId INTEGER,
  createdAt INTEGER,
  updatedAt INTEGER,
  pinned INTEGER DEFAULT 0,
  systemPrompt TEXT,
  tags TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  timestamp INTEGER NOT NULL,
  parentId INTEGER,
  done INTEGER DEFAULT 1,
  metrics TEXT,
  thinking TEXT,
  replayArtifact TEXT,
  error TEXT,
  updatedAt INTEGER,
  FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fileId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  messageId INTEGER,
  fileType TEXT NOT NULL,
  fileName TEXT,
  fileSize INTEGER,
  processedAt INTEGER,
  data BLOB,
  FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
);

-- No embeddings table here by design: the vector store lives in IndexedDB
-- (Dexie) via lib/embeddings/. Persistence convergence (plan 9.3/9.4)
-- deliberately did not migrate embeddings to SQLite. Do not add a vectors
-- table here unless that decision is revisited.

CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- User-authored prompt templates. These can exceed storage.sync's 8 KiB
-- per-item quota, so rows live in SQLite instead of one synced JSON array.
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  systemPrompt TEXT,
  userPrompt TEXT NOT NULL,
  tags TEXT,
  createdAt INTEGER NOT NULL,
  usageCount INTEGER NOT NULL DEFAULT 0,
  sortOrder INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_sortOrder
ON prompt_templates(sortOrder);

-- Resumable checkpoints for tool-calling chat turns. Rows exist only while a
-- tool loop is active and are force-flushed at approval/step boundaries.
CREATE TABLE IF NOT EXISTS tool_loop_runs (
  requestId TEXT PRIMARY KEY,
  sessionId TEXT,
  model TEXT NOT NULL,
  providerId TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  state TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_sessionId ON messages(sessionId);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_files_sessionId ON files(sessionId);
CREATE INDEX IF NOT EXISTS idx_files_messageId ON files(messageId);
CREATE INDEX IF NOT EXISTS idx_tool_loop_runs_sessionId ON tool_loop_runs(sessionId);

-- Cross-store handoff for derived chat vectors. A row is committed with the
-- SQLite message deletion and acknowledged only after idempotent Dexie cleanup.
CREATE TABLE IF NOT EXISTS vector_cleanup_receipts (
  messageId INTEGER PRIMARY KEY,
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vector_cleanup_receipts_createdAt
ON vector_cleanup_receipts(createdAt);

-- Durable owner for every submitted turn. Unlike tool_loop_runs, these rows
-- begin before context building and remain as lifecycle receipts.
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
);

CREATE INDEX IF NOT EXISTS idx_turn_runs_sessionId ON turn_runs(sessionId);
CREATE INDEX IF NOT EXISTS idx_turn_runs_status ON turn_runs(status);

-- Durable metadata for file ingestion. The resumable processed payload and
-- vectors remain in IndexedDB; SQLite owns lifecycle state and recovery.
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
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(status);

-- Durable lifecycle receipts for provider model downloads. Progress is
-- observable after the initiating extension page closes or the worker restarts.
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
);

CREATE INDEX IF NOT EXISTS idx_model_pull_runs_status ON model_pull_runs(status);

-- Agent owns its own lifecycle and never borrows chat rows. The checkpoint is
-- bounded and compacted atomically with a terminal status transition.
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

-- Append-only, bounded evidence. Browser effects are claimed in this log
-- before execution and an interrupted executing/verifying phase is unresolved.
CREATE TABLE IF NOT EXISTS agent_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runId TEXT NOT NULL,
  stepId TEXT NOT NULL,
  status TEXT NOT NULL,
  receipt TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY(runId) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_runId ON agent_steps(runId, id);

-- Chunk feedback table for learning from user feedback
CREATE TABLE IF NOT EXISTS chunk_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_vector_id TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  was_helpful INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  session_id TEXT,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chunk_feedback_lookup ON chunk_feedback(chunk_vector_id, query_hash);
CREATE INDEX IF NOT EXISTS idx_chunk_feedback_timestamp ON chunk_feedback(timestamp);

-- View for aggregated feedback scores
CREATE VIEW IF NOT EXISTS chunk_quality_scores AS
SELECT 
  chunk_vector_id,
  COUNT(*) as total_feedback,
  SUM(CASE WHEN was_helpful = 1 THEN 1 ELSE 0 END) as helpful_count,
  AVG(was_helpful) as avg_score
FROM chunk_feedback
GROUP BY chunk_vector_id;
`
