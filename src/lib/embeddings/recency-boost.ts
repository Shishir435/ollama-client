import { logger } from "@/lib/logger"

/**
 * Calculate recency boost for temporal relevance (RAG v3.0)
 * Uses exponential decay: newer content gets higher boost
 *
 * @param timestamp - Document timestamp in milliseconds
 * @param halfLife - Days for score to decay to 50% (default: 90)
 * @returns Boost factor 0-1 (1 = today, 0.5 = halfLife days old)
 */
export function calculateRecencyBoost(
  timestamp: number,
  halfLife: number = 90
): number {
  if (!timestamp) return 0

  const ageInDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24)

  // Prevent future dates from breaking calculation
  if (ageInDays < 0) return 1

  // Exponential decay: e^(-0.693 * age / halfLife)
  // 0.693 is ln(2), making the half-life exactly 50%
  const lambda = 0.693 / Math.max(1, halfLife)
  const recencyFactor = Math.exp(-lambda * ageInDays)

  return Math.max(0, Math.min(1, recencyFactor))
}

export interface BoostableResult {
  score: number
  document: {
    metadata: {
      timestamp?: number
      created_at?: number
      updated_at?: number
    }
  }
}

/**
 * Apply recency boost to search results
 * Formula: boostedScore = originalScore * (1 + recencyFactor * boostWeight)
 */
export function applyRecencyBoost<T extends BoostableResult>(
  results: T[],
  boostWeight: number = 0.3, // Max 30% boost
  halfLife: number = 90
): void {
  let boostedCount = 0

  for (const result of results) {
    // Try different timestamp fields
    const timestamp =
      result.document.metadata.timestamp ||
      result.document.metadata.updated_at ||
      result.document.metadata.created_at

    if (timestamp) {
      const recencyFactor = calculateRecencyBoost(timestamp, halfLife)

      // Apply boost
      if (recencyFactor > 0.01) {
        const originalScore = result.score
        // Boost score: e.g. 0.8 * (1 + 0.9 * 0.3) = 0.8 * 1.27 = 1.016
        const boostMultiplier = 1 + recencyFactor * boostWeight
        result.score = originalScore * boostMultiplier

        // Log significant boosts (>10% increase)
        if (boostMultiplier > 1.1) {
          boostedCount++
          if (boostedCount <= 3) {
            const ageInDays = Math.round(
              (Date.now() - timestamp) / (1000 * 60 * 60 * 24)
            )
            logger.verbose(
              `Boosted recent doc (${ageInDays}d old)`,
              "RecencyBoost",
              {
                originalScore: originalScore.toFixed(3),
                newScore: result.score.toFixed(3),
                factor: recencyFactor.toFixed(2)
              }
            )
          }
        }
      }
    }
  }
}
