import type { AppFailure } from "@ollama-client/contracts/app-failure"
import { abortableDelay } from "@/lib/abortable-delay"
import type { EmbeddingConfig } from "@/lib/constants"
import { isAbortError } from "@/lib/error-utils"
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
  failure?: AppFailure
}

interface CacheEntry {
  embedding: number[]
  timestamp: number
  routeFingerprint: string
  model: string
  providerId: string
  dimension: number
}

const MAX_RATE_LIMIT_BACKOFF_MS = 30_000
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 250

const rateLimitBackoffMs = (
  results: Array<EmbeddingResult | EmbeddingError>
): number => {
  let backoff = 0
  for (const result of results) {
    const failure = "failure" in result ? result.failure : undefined
    if (failure?.status !== 429) continue
    backoff = Math.max(
      backoff,
      Math.min(
        MAX_RATE_LIMIT_BACKOFF_MS,
        failure.retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS
      )
    )
  }
  return backoff
}

const embeddingCache = new Map<string, CacheEntry>()
const CACHE_MAX_SIZE = 100
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Hash the complete UTF-8 payload. Sampling or a 32-bit rolling hash makes
 * long chunks vulnerable to silent cache collisions, which are especially
 * costly here because the wrong vector still looks valid to the index.
 */
const hashContent = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

const cleanExpiredCache = (): void => {
  const now = Date.now()
  for (const [key, entry] of embeddingCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) embeddingCache.delete(key)
  }
}

const readCachedEmbedding = (
  contentHash: string | undefined,
  routeFingerprint: string | undefined,
  enabled: boolean
): EmbeddingResult | undefined => {
  if (!enabled || !contentHash || !routeFingerprint) return undefined

  const prefix = `${contentHash}:${routeFingerprint}:`
  const candidates: Array<[string, CacheEntry]> = []
  for (const [key, entry] of embeddingCache.entries()) {
    if (!key.startsWith(prefix)) continue
    if (Date.now() - entry.timestamp >= CACHE_TTL_MS) {
      embeddingCache.delete(key)
      continue
    }
    // Keep the identity fields redundant with the key: this makes a future
    // cache-format change fail closed instead of trusting a stale entry.
    if (
      entry.routeFingerprint === routeFingerprint &&
      typeof entry.providerId === "string" &&
      entry.providerId.length > 0 &&
      typeof entry.model === "string" &&
      entry.model.length > 0 &&
      Array.isArray(entry.embedding) &&
      Number.isInteger(entry.dimension) &&
      entry.dimension > 0 &&
      entry.dimension === entry.embedding.length
    ) {
      candidates.push([key, entry])
    }
  }

  // A provider can change vector dimensions without changing its URL/model.
  // If both generations are present, do not guess which one is current.
  if (candidates.length !== 1) return undefined
  const [, cached] = candidates[0]
  return {
    embedding: cached.embedding,
    model: cached.model,
    providerId: cached.providerId
  }
}

const evictOldestCacheEntry = (now: number): void => {
  if (embeddingCache.size < CACHE_MAX_SIZE) return
  let oldestKey: string | null = null
  let oldestTime = now
  for (const [key, entry] of embeddingCache.entries()) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp
      oldestKey = key
    }
  }
  if (oldestKey) embeddingCache.delete(oldestKey)
}

const writeCachedEmbedding = ({
  enabled,
  contentHash,
  expectedRouteFingerprint,
  resolved
}: {
  enabled: boolean
  contentHash?: string
  expectedRouteFingerprint?: string
  resolved: Awaited<ReturnType<typeof generateEmbeddingWithStrategy>>
}): void => {
  if (
    !enabled ||
    !contentHash ||
    !expectedRouteFingerprint ||
    resolved.routeFingerprint !== expectedRouteFingerprint ||
    resolved.embedding.length === 0
  ) {
    return
  }
  const dimension = resolved.embedding.length
  const now = Date.now()
  const prefix = `${contentHash}:${resolved.routeFingerprint}:`
  // A provider may change dimensions without changing its route identity.
  // Keep only the newest generation so a dimension change repairs cache
  // efficiency on the write that discovers it.
  for (const key of embeddingCache.keys()) {
    if (key.startsWith(prefix)) embeddingCache.delete(key)
  }
  if (embeddingCache.size > 0 && embeddingCache.size % 10 === 0) {
    cleanExpiredCache()
  }
  evictOldestCacheEntry(now)
  const cacheKey = `${contentHash}:${resolved.routeFingerprint}:${dimension}`
  embeddingCache.set(cacheKey, {
    embedding: resolved.embedding,
    timestamp: now,
    routeFingerprint: resolved.routeFingerprint,
    model: resolved.model,
    providerId: resolved.providerId,
    dimension
  })
}

const embeddingFailure = (error: unknown): EmbeddingError => {
  const failure = toAppFailure(error, {
    context: "embedding",
    fallbackMessage: "Error generating embedding"
  })
  return {
    error: failure.userMessage ?? "Error generating embedding",
    code: failure.code ?? (failure.kind === "abort" ? "ABORTED" : undefined),
    failure
  }
}

export const generateEmbedding = async (
  text: string,
  modelName?: string,
  config?: EmbeddingConfig,
  options: { plan?: EmbeddingPlan; signal?: AbortSignal } = {}
): Promise<EmbeddingResult | EmbeddingError> => {
  options.signal?.throwIfAborted()
  const resolvedConfig = config ?? (await getEmbeddingConfig())
  const plan = options.plan ?? (await resolveEmbeddingPlan(modelName))
  options.signal?.throwIfAborted()
  const contentHash = await hashContent(text)
  const cached = readCachedEmbedding(
    contentHash,
    plan.cacheFingerprint,
    resolvedConfig.enableCaching
  )
  if (cached) return cached

  try {
    const resolved = await generateEmbeddingWithStrategy(text, modelName, {
      plan,
      ...(options.signal ? { signal: options.signal } : {})
    })
    writeCachedEmbedding({
      enabled: resolvedConfig.enableCaching,
      contentHash,
      expectedRouteFingerprint: plan.cacheFingerprint,
      resolved
    })
    return {
      embedding: resolved.embedding,
      model: resolved.model,
      providerId: resolved.providerId
    }
  } catch (error) {
    if (isAbortError(error)) throw error
    return embeddingFailure(error)
  }
}

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

    if (onProgress) {
      onProgress(Math.min(i + batchSize, texts.length), texts.length)
    }
    if (i + batchSize < texts.length) {
      // Yield between batches without imposing a fixed wall-clock penalty.
      // If a provider explicitly rate-limits a batch, honor its retry hint so
      // the next batch does not immediately amplify the same failure.
      await abortableDelay(rateLimitBackoffMs(batchResults), signal)
    }
  }

  return results
}

export const cosineSimilarity = (
  embedding1: number[],
  embedding2: number[]
): number => {
  if (embedding1.length !== embedding2.length) return 0
  const len = embedding1.length
  if (len === 0) return 0

  let dotProduct = 0
  let norm1 = 0
  let norm2 = 0
  const unrollFactor = 4
  const remainder = len % unrollFactor
  let i = 0

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

export const clearEmbeddingCache = (): void => {
  embeddingCache.clear()
}

export const getCacheSize = (): number => embeddingCache.size

export const getCacheStats = (): { size: number; maxSize: number } => {
  cleanExpiredCache()
  return {
    size: embeddingCache.size,
    maxSize: CACHE_MAX_SIZE
  }
}

export const getEmbeddingRouteCapabilities =
  async (): Promise<EmbeddingStrategyCapabilities> => getEmbeddingCapabilities()

export const ensureEmbeddingRouteReady =
  async (): Promise<EmbeddingStrategyReadiness> =>
    ensureEmbeddingStrategyReady()
