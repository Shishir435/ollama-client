import type { SearchResult } from "./types"

export interface SearchCacheEntry {
  results: SearchResult[]
  timestamp: number
}

/**
 * Removes expired entries and then trims the oldest survivors to the limit.
 * This module stays browser-neutral so tooling can measure retention directly.
 */
export const pruneSearchCache = (
  cache: Map<string, SearchCacheEntry>,
  now: number,
  ttl: number,
  maxSize: number
): void => {
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > ttl) cache.delete(key)
  }

  if (cache.size <= maxSize) return
  const entries = Array.from(cache.entries()).sort(
    (a, b) => a[1].timestamp - b[1].timestamp
  )
  for (const [key] of entries.slice(0, cache.size - maxSize)) {
    cache.delete(key)
  }
}
