import { getEmbeddingConfig } from "./config"
import type { SearchResult, VectorDocument } from "./types"

/**
 * Search result cache (query hash -> results)
 * Cache TTL and max size are configurable via EmbeddingConfig
 */
export interface SearchCacheEntry {
  results: SearchResult[]
  timestamp: number
}

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
  for (const [key, entry] of searchCache.entries()) {
    if (now - entry.timestamp > ttl) {
      searchCache.delete(key)
    }
  }

  // If cache is still too large, remove oldest entries
  if (searchCache.size > maxSize) {
    const entries = Array.from(searchCache.entries())
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toRemove = entries.slice(0, searchCache.size - maxSize)
    for (const [key] of toRemove) {
      searchCache.delete(key)
    }
  }
}
