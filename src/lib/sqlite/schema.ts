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
`
