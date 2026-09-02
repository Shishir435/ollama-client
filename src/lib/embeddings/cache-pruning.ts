import type { SearchResult } from "./types"

export interface SearchCacheEntry {
  results: SearchResult[]
  timestamp: number
}

/**
 * Removes expired entries and then trims the oldest inserted survivors to the
 * limit. This module stays browser-neutral so tooling can measure retention
 * directly.
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

  // Map insertion order is stable and avoids sorting the whole cache on every
  // search miss; deleting from the front is linear in actual evictions.
  const toEvict = cache.size - maxSize
  let evicted = 0
  for (const key of cache.keys()) {
    cache.delete(key)
    evicted += 1
    if (evicted === toEvict) break
  }
}
