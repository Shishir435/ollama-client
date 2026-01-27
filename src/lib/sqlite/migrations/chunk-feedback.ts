/**
 * SQLite migration for chunk feedback table
 * Enables privacy-first user feedback learning
 */

export const CHUNK_FEEDBACK_MIGRATION = `
-- Chunk feedback for local learning
CREATE TABLE IF NOT EXISTS chunk_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_vector_id TEXT NOT NULL,  -- Reference to vector ID in Vectra
  query_hash TEXT NOT NULL,        -- SHA256(query) for privacy
  was_helpful INTEGER NOT NULL,    -- 1 = helpful, 0 = not helpful (SQLite boolean)
  timestamp INTEGER NOT NULL,
  session_id TEXT,                  -- Optional: tie to chat session
  CONSTRAINT fk_session
    FOREIGN KEY (session_id)
    REFERENCES chat_sessions(id)
    ON DELETE SET NULL
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_chunk_feedback_lookup 
  ON chunk_feedback(chunk_vector_id, query_hash);

-- Index for timestamp-based cleanup
CREATE INDEX IF NOT EXISTS idx_chunk_feedback_timestamp
  ON chunk_feedback(timestamp);

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

/**
 * Apply chunk feedback migration
 */
export async function applyChunkFeedbackMigration(db: any): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(CHUNK_FEEDBACK_MIGRATION, (err: any) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}
