import type { AppFailure } from "@ollama-client/contracts/app-failure"
import { abortableDelay } from "@/lib/abortable-delay"
import type { EmbeddingConfig } from "@/lib/constants"
import { getErrorMessage, isAbortError } from "@/lib/error-utils"
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
}

const embeddingCache = new Map<string, CacheEntry>()
const CACHE_MAX_SIZE = 100
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

const hashContent = (text: string): string => {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return `${hash.toString(36)}:${text.length.toString(36)}`
}

const cleanExpiredCache = (): void => {
  const now = Date.now()
  for (const [key, entry] of embeddingCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) embeddingCache.delete(key)
  }
}

const readCachedEmbedding = (
  cacheKey: string | undefined,
  enabled: boolean
): EmbeddingResult | undefined => {
  if (!enabled || !cacheKey) return undefined
  const cached = embeddingCache.get(cacheKey)
  if (!cached) return undefined
  if (Date.now() - cached.timestamp >= CACHE_TTL_MS) {
    embeddingCache.delete(cacheKey)
    return undefined
  }
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
  cacheKey,
  expectedRouteFingerprint,
  resolved
}: {
  enabled: boolean
  cacheKey?: string
  expectedRouteFingerprint?: string
  resolved: Awaited<ReturnType<typeof generateEmbeddingWithStrategy>>
}): void => {
  if (
    !enabled ||
    !cacheKey ||
    resolved.routeFingerprint !== expectedRouteFingerprint
  ) {
    return
  }
  const now = Date.now()
  if (embeddingCache.size > 0 && embeddingCache.size % 10 === 0) {
    cleanExpiredCache()
  }
  evictOldestCacheEntry(now)
  embeddingCache.set(cacheKey, {
    embedding: resolved.embedding,
    timestamp: now,
    routeFingerprint: resolved.routeFingerprint,
    model: resolved.model,
    providerId: resolved.providerId
  })
}

const embeddingFailure = (error: unknown): EmbeddingError => {
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

export const generateEmbedding = async (
  text: string,
  modelName?: string,
  config?: EmbeddingConfig,
  options: { plan?: EmbeddingPlan; signal?: AbortSignal } = {}
): Promise<EmbeddingResult | EmbeddingError> => {
  const resolvedConfig = config ?? (await getEmbeddingConfig())
  const plan = options.plan ?? (await resolveEmbeddingPlan(modelName))
  const cacheKey = plan.cacheFingerprint
    ? `${hashContent(text)}:${plan.cacheFingerprint}`
    : undefined
  const cached = readCachedEmbedding(cacheKey, resolvedConfig.enableCaching)
  if (cached) return cached

  try {
    const resolved = await generateEmbeddingWithStrategy(text, modelName, {
      plan,
      ...(options.signal ? { signal: options.signal } : {})
    })
    writeCachedEmbedding({
      enabled: resolvedConfig.enableCaching,
      cacheKey,
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
      await abortableDelay(100, signal)
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
