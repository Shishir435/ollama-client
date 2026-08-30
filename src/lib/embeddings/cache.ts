import { pruneSearchCache, type SearchCacheEntry } from "./cache-pruning"
import { getEmbeddingConfig } from "./config"
import type { VectorDocument } from "./types"

/**
 * Search result cache (query hash -> results)
 * Cache TTL and max size are configurable via EmbeddingConfig
 */
export const searchCache = new Map<string, SearchCacheEntry>()

/**
 * Gets cache configuration from settings
 */
export const getCacheConfig = async (): Promise<{
  ttl: number
  maxSize: number
}> => {
  const config = await getEmbeddingConfig()
  return {
    ttl: config.searchCacheTTL * 60 * 1000, // Convert minutes to milliseconds
    maxSize: config.searchCacheMaxSize
  }
}

/**
 * Creates a hash for search query caching
 */
export const hashSearchQuery = (
  queryEmbedding: number[],
  options: {
    limit?: number
    minSimilarity?: number
    type?: VectorDocument["metadata"]["type"]
    sessionId?: string
    fileId?: string | string[]
    embeddingModel?: string
    embeddingProviderId?: string
    embeddingDimension?: number
  }
): string => {
  // Create a simple hash from query embedding and options
  const queryHash = queryEmbedding.slice(0, 10).join(",")
  const optionsStr = JSON.stringify(options)
  return `${queryHash}:${optionsStr}`
}

/**
 * Cleans expired search cache entries
 */
export const cleanSearchCache = async (): Promise<void> => {
  const { ttl, maxSize } = await getCacheConfig()
  const now = Date.now()
  pruneSearchCache(searchCache, now, ttl, maxSize)
}
