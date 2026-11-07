import type { MigrationDatabase } from "./database"

export const MESSAGE_INDEX_JOBS_SQL = `
CREATE TABLE IF NOT EXISTS message_index_jobs (
  messageId INTEGER PRIMARY KEY,
  token TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS message_index_insert AFTER INSERT ON messages
WHEN NEW.role IN ('user', 'assistant') AND NEW.done = 1
BEGIN
  INSERT OR REPLACE INTO message_index_jobs VALUES (NEW.id, lower(hex(randomblob(16))));
END;
CREATE TRIGGER IF NOT EXISTS message_index_update AFTER UPDATE OF content, done ON messages
WHEN NEW.role IN ('user', 'assistant') AND NEW.done = 1
BEGIN
  INSERT OR REPLACE INTO message_index_jobs VALUES (NEW.id, lower(hex(randomblob(16))));
END;
CREATE TRIGGER IF NOT EXISTS message_index_delete AFTER DELETE ON messages
BEGIN
  DELETE FROM message_index_jobs WHERE messageId = OLD.id;
  INSERT OR IGNORE INTO vector_cleanup_receipts VALUES (OLD.id, 0);
END;
`

/** Queue ids, never copies of message content; completion can resume after worker loss. */
export const ensureMessageIndexJobs = (db: MigrationDatabase): void => {
  db.run(MESSAGE_INDEX_JOBS_SQL)
}
