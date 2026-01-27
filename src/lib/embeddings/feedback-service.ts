import { logger } from "@/lib/logger"
import { query as dbQuery, run as dbRun, initSQLite } from "@/lib/sqlite/db"

/**
 * Privacy-First Feedback Service
 *
 * Stores user feedback on retrieved chunks to improve future retrieval.
 * All data stored locally, queries are hashed for privacy.
 */

export interface ChunkFeedback {
  id?: number
  chunkVectorId: string
  queryHash: string
  wasHelpful: boolean
  timestamp: number
  sessionId?: string
}

export interface AggregatedScore {
  chunkVectorId: string
  totalFeedback: number
  helpfulCount: number
  avgScore: number
}

class FeedbackService {
  /**
   * Record user feedback for a chunk
   */
  async recordFeedback(
    chunkVectorId: string,
    query: string,
    wasHelpful: boolean,
    sessionId?: string
  ): Promise<void> {
    try {
      const queryHash = await this.hashQuery(query)
      const timestamp = Date.now()

      await dbRun(
        `INSERT INTO chunk_feedback (chunk_vector_id, query_hash, was_helpful, timestamp, session_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          chunkVectorId,
          queryHash,
          wasHelpful ? 1 : 0,
          timestamp,
          sessionId || null
        ]
      )

      logger.info(
        `Recorded feedback for chunk ${chunkVectorId}`,
        "FeedbackService",
        {
          wasHelpful,
          queryHash: queryHash.substring(0, 8)
        }
      )
    } catch (error) {
      logger.error("Failed to record feedback", "FeedbackService", { error })
      throw error
    }
  }

  /**
   * Get feedback score for a specific chunk + query combination
   * Uses Bayesian smoothing to avoid extreme scores with little data
   */
  async getFeedbackScore(
    chunkVectorId: string,
    query: string
  ): Promise<number | null> {
    try {
      const queryHash = await this.hashQuery(query)

      const results = await dbQuery(
        `SELECT 
          COUNT(*) as total,
          SUM(was_helpful) as helpful
         FROM chunk_feedback
         WHERE chunk_vector_id = ? AND query_hash = ?`,
        [chunkVectorId, queryHash]
      )

      const result = results[0]
      if (!result || result.total === 0) {
        return null
      }

      // Bayesian smoothing
      const score = (Number(result.helpful) + 1) / (Number(result.total) + 2)
      return score
    } catch (error) {
      logger.error("Failed to get feedback score", "FeedbackService", { error })
      return null
    }
  }

  /**
   * Get aggregate quality score for a chunk (all queries)
   */
  async getAggregateScore(
    chunkVectorId: string
  ): Promise<AggregatedScore | null> {
    try {
      const db = await initSQLite()

      const result = await new Promise<any>((resolve, reject) => {
        db.get(
          `SELECT * FROM chunk_quality_scores WHERE chunk_vector_id = ?`,
          [chunkVectorId],
          (err: any, row: any) => {
            if (err) reject(err)
            else resolve(row)
          }
        )
      })

      if (!result) {
        return null
      }

      return {
        chunkVectorId: result.chunk_vector_id,
        totalFeedback: result.total_feedback,
        helpfulCount: result.helpful_count,
        avgScore: result.avg_score
      }
    } catch (error) {
      logger.error("Failed to get aggregate score", "FeedbackService", {
        error
      })
      return null
    }
  }

  /**
   * Export all feedback data (for privacy transparency)
   */
  async exportFeedback(): Promise<ChunkFeedback[]> {
    try {
      const db = await initSQLite()

      const rows = await new Promise<any[]>((resolve, reject) => {
        db.all(
          `SELECT id, chunk_vector_id, query_hash, was_helpful, timestamp, session_id
           FROM chunk_feedback
           ORDER BY timestamp DESC`,
          [],
          (err: any, rows: any[]) => {
            if (err) reject(err)
            else resolve(rows || [])
          }
        )
      })

      return rows.map((row) => ({
        id: row.id,
        chunkVectorId: row.chunk_vector_id,
        queryHash: row.query_hash,
        wasHelpful: row.was_helpful === 1,
        timestamp: row.timestamp,
        sessionId: row.session_id
      }))
    } catch (error) {
      logger.error("Failed to export feedback", "FeedbackService", { error })
      return []
    }
  }

  /**
   * Clear all feedback data
   */
  async clearAllFeedback(): Promise<void> {
    try {
      const db = await initSQLite()

      await new Promise<void>((resolve, reject) => {
        db.run(`DELETE FROM chunk_feedback`, [], (err: any) => {
          if (err) reject(err)
          else resolve()
        })
      })

      logger.info("Cleared all feedback data", "FeedbackService")
    } catch (error) {
      logger.error("Failed to clear feedback", "FeedbackService", { error })
      throw error
    }
  }

  /**
   * Clear feedback for a specific chunk
   */
  async clearFeedbackForChunk(chunkVectorId: string): Promise<void> {
    try {
      const db = await initSQLite()

      await new Promise<void>((resolve, reject) => {
        db.run(
          `DELETE FROM chunk_feedback WHERE chunk_vector_id = ?`,
          [chunkVectorId],
          (err: any) => {
            if (err) reject(err)
            else resolve()
          }
        )
      })

      logger.info(
        `Cleared feedback for chunk ${chunkVectorId}`,
        "FeedbackService"
      )
    } catch (error) {
      logger.error("Failed to clear chunk feedback", "FeedbackService", {
        error
      })
      throw error
    }
  }

  /**
   * Hash query for privacy (SHA-256)
   */
  private async hashQuery(query: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(query.toLowerCase().trim())
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
  }

  /**
   * Get feedback statistics
   */
  async getStatistics(): Promise<{
    totalFeedback: number
    helpfulPercentage: number
    uniqueChunks: number
    uniqueQueries: number
  }> {
    try {
      const db = await initSQLite()

      const stats = await new Promise<any>((resolve, reject) => {
        db.get(
          `SELECT 
            COUNT(*) as total,
            SUM(was_helpful) as helpful,
            COUNT(DISTINCT chunk_vector_id) as unique_chunks,
            COUNT(DISTINCT query_hash) as unique_queries
           FROM chunk_feedback`,
          [],
          (err: any, row: any) => {
            if (err) reject(err)
            else resolve(row)
          }
        )
      })

      return {
        totalFeedback: stats.total || 0,
        helpfulPercentage:
          stats.total > 0 ? (stats.helpful / stats.total) * 100 : 0,
        uniqueChunks: stats.unique_chunks || 0,
        uniqueQueries: stats.unique_queries || 0
      }
    } catch (error) {
      logger.error("Failed to get statistics", "FeedbackService", { error })
      return {
        totalFeedback: 0,
        helpfulPercentage: 0,
        uniqueChunks: 0,
        uniqueQueries: 0
      }
    }
  }
}

export const feedbackService = new FeedbackService()
