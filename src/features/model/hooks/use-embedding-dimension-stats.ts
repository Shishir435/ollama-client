import { useCallback, useEffect, useState } from "react"

import { getEmbeddingDimensionStats } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"

export interface EmbeddingDimensionStats {
  totalVectors: number
  byDimension: Record<string, number>
  mixedDimensions: boolean
  dominantDimension: number | null
}

export interface UseEmbeddingDimensionStatsResult {
  stats: EmbeddingDimensionStats | null
  /** Re-read the stats from the vector store. Useful after a rebuild. */
  refresh: () => Promise<void>
}

/**
 * Loads vector-store dimension stats once on mount and exposes a
 * `refresh()` to re-read after operations that change the store
 * (rebuild, clear-all, dimension migration).
 *
 * Errors are logged but never thrown to the caller — the consuming UI
 * just sees `stats: null` and renders accordingly.
 */
export const useEmbeddingDimensionStats =
  (): UseEmbeddingDimensionStatsResult => {
    const [stats, setStats] = useState<EmbeddingDimensionStats | null>(null)

    const refresh = useCallback(async () => {
      try {
        const next = await getEmbeddingDimensionStats()
        setStats(next)
      } catch (error) {
        logger.error(
          "Failed to load embedding dimension stats",
          "useEmbeddingDimensionStats",
          { error }
        )
      }
    }, [])

    useEffect(() => {
      refresh()
    }, [refresh])

    return { stats, refresh }
  }
