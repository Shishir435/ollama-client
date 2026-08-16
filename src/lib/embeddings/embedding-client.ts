import type { AppFailure } from "@ollama-client/contracts/app-failure"
import { abortableDelay } from "@/lib/abortable-delay"
import type { EmbeddingConfig } from "@/lib/constants"
import { getErrorMessage } from "@/lib/error-utils"
import { toAppFailure } from "@/protocol/app-failure"
import { getEmbeddingConfig } from "./config"
import {
  type EmbeddingPlan,
  type EmbeddingStrategyCapabilities,
  type EmbeddingStrategyReadiness,
  ensureEmbeddingStrategyReady,
  generateEmbeddingWithStrategy,
  getEmbeddingCapabilities,
  resolveEmbeddingPlan
} from "./embedding-strategy"

export interface EmbeddingResult {
  embedding: number[]
  model: string
  providerId: string
}

export interface EmbeddingError {
  error: string
  code?: string
  /**
   * The structured failure behind `error`.
   *
   * `error`/`code` stay for existing callers, but they flattened every cause to
   * one string and `NETWORK_ERROR`: an abort, a bad API key, a missing model
   * and a malformed response all arrived identically, so no caller could decide
   * whether to retry and no diagnostic could say what happened. The failure
   * carries kind, code, phase, provider and retryability through unchanged.
   */
  failure?: AppFailure
}

/**
 * A cached vector, tagged with the route that produced it.
 *
 * `routeFingerprint` is the plan the vector came from and is part of the key.
 * The resolved provider and model are recorded separately because the plan
 * describes the routes that were available while these name the one that
 * actually answered — a fallback reports itself, rather than the head of the
 * plan, to whoever reads the hit.
 */
interface CacheEntry {
  embedding: number[]
  timestamp: number
  routeFingerprint: string
  model: string
  providerId: string
}

const embeddingCache = new Map<string, CacheEntry>()
const CACHE_MAX_SIZE = 100
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Content hash for the embedding cache.
 *
 * Covers the whole input. The previous sampled variant bounded its loop by the
 * sample count rather than the text length, so for anything over 1000
 * characters it read only positions inside the first 1000 — a 100 KB chunk was
 * identified by ten characters ending at index 900. Two chunks sharing an
 * opening then collided and the cache returned the wrong vector, with no error
 * path and no way to notice beyond degraded retrieval. A full pass over a
 * ~500-token chunk is negligible next to the embedding request it guards.
 *
 * The length is mixed in so inputs that differ only by a suffix the character
 * loop happens to cancel out cannot collide on the digest alone.
 */
const hashContent = (text: string): string => {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return `${hash.toString(36)}:${text.length.toString(36)}`
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
 * Generates embeddings for text using the browser-safe embedding strategy chain.
 * Optimized with caching and batch processing support.
 *
 * `config` and `plan` let a batch caller resolve those snapshots once and reuse
 * them for every item instead of re-resolving per chunk.
 */
export const generateEmbedding = async (
  text: string,
  modelName?: string,
  config?: EmbeddingConfig,
  options: { plan?: EmbeddingPlan; signal?: AbortSignal } = {}
): Promise<EmbeddingResult | EmbeddingError> => {
  const resolvedConfig = config ?? (await getEmbeddingConfig())
  // The plan is resolved before the cache is consulted, not after: its
  // fingerprint is the key's route half, so a lookup that skipped it would be
  // asking "any vector for this text" — which is what returned another
  // provider's vector after a routing change.
  const plan = options.plan ?? (await resolveEmbeddingPlan(modelName))
  const cacheKey = `${hashContent(text)}:${plan.fingerprint}`

  // Check cache if enabled
  if (resolvedConfig.enableCaching) {
    const cached = embeddingCache.get(cacheKey)
    if (cached) {
      // Check if cache entry is still valid (not expired)
      const now = Date.now()
      if (now - cached.timestamp < CACHE_TTL_MS) {
        return {
          embedding: cached.embedding,
          model: cached.model,
          providerId: cached.providerId
        }
      } else {
        // Remove expired entry
        embeddingCache.delete(cacheKey)
      }
    }
  }
  try {
    const resolved = await generateEmbeddingWithStrategy(text, modelName, {
      plan,
      ...(options.signal ? { signal: options.signal } : {})
    })
    const embedding = resolved.embedding

    // Cache if enabled
    if (resolvedConfig.enableCaching) {
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

      embeddingCache.set(cacheKey, {
        embedding,
        timestamp: now,
        routeFingerprint: plan.fingerprint,
        model: resolved.model,
        providerId: resolved.providerId
      })
    }

    return {
      embedding,
      model: resolved.model,
      providerId: resolved.providerId
    }
  } catch (error) {
    const failure = toAppFailure(error, {
      context: "embedding",
      fallbackMessage: "Error generating embedding"
    })
    return {
      error: `Error generating embedding: ${getErrorMessage(error)}`,
      code: failure.code ?? (failure.kind === "abort" ? "ABORTED" : undefined),
      failure
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
  onProgress?: (current: number, total: number) => void,
  signal?: AbortSignal
): Promise<(EmbeddingResult | EmbeddingError)[]> => {
  const config = await getEmbeddingConfig()
  const plan = await resolveEmbeddingPlan(modelName)
  const batchSize = config.batchSize || 5
  const results: (EmbeddingResult | EmbeddingError)[] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    signal?.throwIfAborted()
    const batch = texts.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map((text) =>
        generateEmbedding(text, modelName, config, {
          plan,
          ...(signal ? { signal } : {})
        })
      )
    )
    results.push(...batchResults)

    // Report progress
    if (onProgress) {
      onProgress(Math.min(i + batchSize, texts.length), texts.length)
    }

    // Small delay between batches to prevent overwhelming the server
    if (i + batchSize < texts.length) {
      await abortableDelay(100, signal)
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
    return 0
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
