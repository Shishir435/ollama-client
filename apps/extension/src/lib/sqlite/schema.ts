export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  modelId TEXT,
  currentLeafId INTEGER,
  createdAt INTEGER,
  updatedAt INTEGER
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

CREATE TABLE IF NOT EXISTS vectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  embedding BLOB NOT NULL,
  metadata TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_sessionId ON messages(sessionId);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_files_sessionId ON files(sessionId);
CREATE INDEX IF NOT EXISTS idx_files_messageId ON files(messageId);

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
