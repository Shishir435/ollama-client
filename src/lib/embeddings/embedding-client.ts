import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import {
  type EmbeddingStrategyCapabilities,
  type EmbeddingStrategyReadiness,
  ensureEmbeddingStrategyReady,
  generateEmbeddingWithStrategy,
  getEmbeddingCapabilities
} from "./embedding-strategy"

export interface EmbeddingResult {
  embedding: number[]
  model: string
}

export interface EmbeddingError {
  error: string
  code?: string
}

// Cache for embeddings with timestamp for TTL (content hash -> { embedding, timestamp })
interface CacheEntry {
  embedding: number[]
  timestamp: number
  modelKey: string
}

const embeddingCache = new Map<string, CacheEntry>()
const CACHE_MAX_SIZE = 100
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Simple hash function for content caching
 * Optimized for performance
 */
const hashContent = (text: string): string => {
  // Use a faster hash for short strings, more robust for long strings
  if (text.length < 100) {
    // Simple hash for short strings
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
    }
    return hash.toString()
  }

  // For longer strings, use a more efficient approach
  // Take samples instead of processing entire string
  const sampleSize = Math.min(1000, text.length)
  const step = Math.floor(text.length / sampleSize)
  let hash = 0
  for (let i = 0; i < sampleSize; i += step) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return hash.toString()
}

/**
 * Cleans expired cache entries
 */
const cleanExpiredCache = (): void => {
  const now = Date.now()
  for (const [key, entry] of embeddingCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      embeddingCache.delete(key)
    }
  }
}

/**
 * Gets embedding configuration with defaults
 */
const getEmbeddingConfig = async (): Promise<EmbeddingConfig> => {
  const stored = await plasmoGlobalStorage.get<EmbeddingConfig>(
    STORAGE_KEYS.EMBEDDINGS.CONFIG
  )
  return {
    ...DEFAULT_EMBEDDING_CONFIG,
    ...stored
  }
}

const getCacheModelKey = async (modelName?: string): Promise<string> => {
  if (modelName) {
    return modelName
  }

  const stored = await plasmoGlobalStorage.get<string>(
    STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL
  )
  return stored || "default"
}

/**
 * Generates embeddings for text using the browser-safe embedding strategy chain.
 * Optimized with caching and batch processing support.
 */
export const generateEmbedding = async (
  text: string,
  modelName?: string
): Promise<EmbeddingResult | EmbeddingError> => {
  const config = await getEmbeddingConfig()
  const modelKey = await getCacheModelKey(modelName)

  // Check cache if enabled
  if (config.enableCaching) {
    const contentHash = `${hashContent(text)}:${modelKey}`
    const cached = embeddingCache.get(contentHash)
    if (cached) {
      // Check if cache entry is still valid (not expired)
      const now = Date.now()
      if (
        now - cached.timestamp < CACHE_TTL_MS &&
        cached.modelKey === modelKey
      ) {
        return {
          embedding: cached.embedding,
          model: modelName || modelKey
        }
      } else {
        // Remove expired entry
        embeddingCache.delete(contentHash)
      }
    }
  }
  try {
    const resolved = await generateEmbeddingWithStrategy(text, modelName)
    const embedding = resolved.embedding

    // Cache if enabled
    if (config.enableCaching) {
      const contentHash = `${hashContent(text)}:${modelKey}`
      const now = Date.now()

      // Clean expired entries periodically (every 10th insertion)
      if (embeddingCache.size > 0 && embeddingCache.size % 10 === 0) {
        cleanExpiredCache()
      }

      // If cache is full, remove oldest entry (LRU-style)
      if (embeddingCache.size >= CACHE_MAX_SIZE) {
        // Find oldest entry
        let oldestKey: string | null = null
        let oldestTime = now

        for (const [key, entry] of embeddingCache.entries()) {
          if (entry.timestamp < oldestTime) {
            oldestTime = entry.timestamp
            oldestKey = key
          }
        }

        if (oldestKey) {
          embeddingCache.delete(oldestKey)
        }
      }

      embeddingCache.set(contentHash, {
        embedding,
        timestamp: now,
        modelKey
      })
    }

    return {
      embedding,
      model: resolved.model
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      error: `Error generating embedding: ${errorMessage}`,
      code: "NETWORK_ERROR"
    }
  }
}

/**
 * Generates embeddings for multiple texts in batch
 * Optimized with configurable batch size and progress tracking
 */
export const generateEmbeddingsBatch = async (
  texts: string[],
  modelName?: string,
  onProgress?: (current: number, total: number) => void
): Promise<(EmbeddingResult | EmbeddingError)[]> => {
  const config = await getEmbeddingConfig()
  const batchSize = config.batchSize || 5
  const results: (EmbeddingResult | EmbeddingError)[] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map((text) => generateEmbedding(text, modelName))
    )
    results.push(...batchResults)

    // Report progress
    if (onProgress) {
      onProgress(Math.min(i + batchSize, texts.length), texts.length)
    }

    // Small delay between batches to prevent overwhelming the server
    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  return results
}

/**
 * Calculates cosine similarity between two embeddings
 * Optimized for performance with SIMD-friendly operations
 */
export const cosineSimilarity = (
  embedding1: number[],
  embedding2: number[]
): number => {
  if (embedding1.length !== embedding2.length) {
    throw new Error("Embeddings must have the same dimension")
  }

  const len = embedding1.length

  // Early exit for zero-length embeddings
  if (len === 0) return 0

  let dotProduct = 0
  let norm1 = 0
  let norm2 = 0

  // Use loop unrolling for better performance on modern JS engines
  // Process 4 elements at a time when possible
  const unrollFactor = 4
  const remainder = len % unrollFactor
  let i = 0

  // Unrolled loop for better performance
  for (; i < len - remainder; i += unrollFactor) {
    const v1_0 = embedding1[i]
    const v2_0 = embedding2[i]
    const v1_1 = embedding1[i + 1]
    const v2_1 = embedding2[i + 1]
    const v1_2 = embedding1[i + 2]
    const v2_2 = embedding2[i + 2]
    const v1_3 = embedding1[i + 3]
    const v2_3 = embedding2[i + 3]

    dotProduct += v1_0 * v2_0 + v1_1 * v2_1 + v1_2 * v2_2 + v1_3 * v2_3
    norm1 += v1_0 * v1_0 + v1_1 * v1_1 + v1_2 * v1_2 + v1_3 * v1_3
    norm2 += v2_0 * v2_0 + v2_1 * v2_1 + v2_2 * v2_2 + v2_3 * v2_3
  }

  // Process remaining elements
  for (; i < len; i++) {
    const v1 = embedding1[i]
    const v2 = embedding2[i]
    dotProduct += v1 * v2
    norm1 += v1 * v1
    norm2 += v2 * v2
  }

  const denominator = Math.sqrt(norm1 * norm2)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

/**
 * Clears the embedding cache
 */
export const clearEmbeddingCache = (): void => {
  embeddingCache.clear()
}

/**
 * Gets cache size (for monitoring)
 */
export const getCacheSize = (): number => {
  return embeddingCache.size
}

/**
 * Gets cache statistics
 */
export const getCacheStats = (): { size: number; maxSize: number } => {
  // Clean expired entries before returning stats
  cleanExpiredCache()
  return {
    size: embeddingCache.size,
    maxSize: CACHE_MAX_SIZE
  }
}

/**
 * Embedding strategy capability snapshot for diagnostics.
 */
export const getEmbeddingRouteCapabilities =
  async (): Promise<EmbeddingStrategyCapabilities> => {
    return getEmbeddingCapabilities()
  }

/**
 * Trigger best-effort strategy warmup without blocking chat/file workflows.
 */
export const ensureEmbeddingRouteReady =
  async (): Promise<EmbeddingStrategyReadiness> => {
    return ensureEmbeddingStrategyReady()
  }
