import Dexie, { type Table } from "dexie"
import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

/**
 * Normalizes a vector to unit length (L2 normalization)
 * Returns the normalized vector and its norm
 */
const normalizeVector = (
  embedding: number[]
): { normalized: number[]; norm: number } => {
  const len = embedding.length
  if (len === 0) {
    return { normalized: [], norm: 0 }
  }

  // Calculate L2 norm
  let norm = 0
  for (let i = 0; i < len; i++) {
    norm += embedding[i] * embedding[i]
  }
  norm = Math.sqrt(norm)

  if (norm === 0) {
    return { normalized: new Array(len).fill(0), norm: 0 }
  }

  // Normalize
  const normalized = new Array(len)
  for (let i = 0; i < len; i++) {
    normalized[i] = embedding[i] / norm
  }

  return { normalized, norm }
}

/**
 * Optimized cosine similarity using Float32Array and pre-normalized vectors
 * If normalized embeddings are available, uses dot product directly (much faster)
 */
const cosineSimilarityOptimized = (
  queryNormalized: number[],
  queryNorm: number,
  docEmbedding: number[],
  docNorm?: number,
  docNormalized?: number[]
): number => {
  const len = queryNormalized.length

  if (len === 0) return 0
  if (len !== docEmbedding.length) {
    throw new Error("Embeddings must have the same dimension")
  }

  // Convert to Float32Array for better performance
  const queryArr = new Float32Array(queryNormalized)

  // If document has normalized embedding, use dot product directly (fastest)
  // Both vectors are normalized, so dot product = cosine similarity
  if (docNormalized) {
    const docArr = new Float32Array(docNormalized)
    let dotProduct = 0

    // Unrolled loop for better performance
    const unrollFactor = 4
    const remainder = len % unrollFactor
    let i = 0

    for (; i < len - remainder; i += unrollFactor) {
      dotProduct +=
        queryArr[i] * docArr[i] +
        queryArr[i + 1] * docArr[i + 1] +
        queryArr[i + 2] * docArr[i + 2] +
        queryArr[i + 3] * docArr[i + 3]
    }

    for (; i < len; i++) {
      dotProduct += queryArr[i] * docArr[i]
    }

    // Both vectors are normalized, so dot product equals cosine similarity
    return dotProduct
  }

  // Fallback: compute similarity with pre-computed norms (faster than full computation)
  if (docNorm !== undefined) {
    const docArr = new Float32Array(docEmbedding)
    let dotProduct = 0

    const unrollFactor = 4
    const remainder = len % unrollFactor
    let i = 0

    for (; i < len - remainder; i += unrollFactor) {
      dotProduct +=
        queryArr[i] * docArr[i] +
        queryArr[i + 1] * docArr[i + 1] +
        queryArr[i + 2] * docArr[i + 2] +
        queryArr[i + 3] * docArr[i + 3]
    }

    for (; i < len; i++) {
      dotProduct += queryArr[i] * docArr[i]
    }

    const denominator = queryNorm * docNorm
    return denominator === 0 ? 0 : dotProduct / denominator
  }

  // Fallback: compute similarity manually using normalized query
  // This handles cases where document doesn't have normalized embedding
  const docArr = new Float32Array(docEmbedding)
  let dotProduct = 0
  let docNormSquared = 0

  const unrollFactor = 4
  const remainder = len % unrollFactor
  let i = 0

  for (; i < len - remainder; i += unrollFactor) {
    const q0 = queryArr[i]
    const q1 = queryArr[i + 1]
    const q2 = queryArr[i + 2]
    const q3 = queryArr[i + 3]
    const d0 = docArr[i]
    const d1 = docArr[i + 1]
    const d2 = docArr[i + 2]
    const d3 = docArr[i + 3]

    dotProduct += q0 * d0 + q1 * d1 + q2 * d2 + q3 * d3
    docNormSquared += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3
  }

  for (; i < len; i++) {
    dotProduct += queryArr[i] * docArr[i]
    docNormSquared += docArr[i] * docArr[i]
  }

  const calculatedDocNorm = Math.sqrt(docNormSquared)
  const denominator = queryNorm * calculatedDocNorm
  return denominator === 0 ? 0 : dotProduct / denominator
}

export interface VectorDocument {
  id?: number
  content: string
  embedding: number[]
  // Normalized embedding (L2 normalized) - stored separately for performance
  // If not present, will be computed on-the-fly for backwards compatibility
  normalizedEmbedding?: number[]
  // Pre-computed L2 norm - speeds up similarity calculation
  norm?: number
  metadata: {
    type: "chat" | "file" | "webpage"
    sessionId?: string
    fileId?: string
    url?: string
    title?: string
    timestamp: number
    chunkIndex?: number
    totalChunks?: number
  }
}

export interface SearchResult {
  document: VectorDocument
  similarity: number
}

class VectorDatabase extends Dexie {
  vectors!: Table<VectorDocument>

  constructor() {
    super("VectorDatabase")
    this.version(1).stores({
      vectors:
        "++id, metadata.type, metadata.sessionId, metadata.fileId, metadata.url, metadata.timestamp"
    })
  }
}

export const vectorDb = new VectorDatabase()

/**
 * Search result cache (query hash -> results)
 * Cache TTL and max size are configurable via EmbeddingConfig
 */
interface SearchCacheEntry {
  results: SearchResult[]
  timestamp: number
}

const searchCache = new Map<string, SearchCacheEntry>()

/**
 * Gets cache configuration from settings
 */
const getCacheConfig = async (): Promise<{
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
const hashSearchQuery = (
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
const cleanSearchCache = async (): Promise<void> => {
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

/**
 * Gets embedding configuration
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

/**
 * Estimates storage size in bytes for a vector document
 */
const estimateStorageSize = (doc: VectorDocument): number => {
  const embeddingSize = doc.embedding.length * 4 // 4 bytes per float32
  const normalizedSize = doc.normalizedEmbedding
    ? doc.normalizedEmbedding.length * 4
    : 0
  const contentSize = new Blob([doc.content]).size
  const metadataSize = JSON.stringify(doc.metadata).length
  return embeddingSize + normalizedSize + contentSize + metadataSize + 100 // +100 for overhead
}

/**
 * Checks and enforces storage limits
 * Optimized to avoid loading all vectors into memory at once
 */
const checkStorageLimit = async (): Promise<void> => {
  const config = await getEmbeddingConfig()
  if (config.maxStorageSize === 0) return // Unlimited

  const maxSizeBytes = config.maxStorageSize * 1024 * 1024 // Convert MB to bytes
  let totalSize = 0
  const sizes: Array<{ id: number; size: number; timestamp: number }> = []

  // Process in batches to avoid blocking main thread
  const batchSize = 100
  let offset = 0
  let hasMore = true

  while (hasMore) {
    // Use cursor-based pagination instead of loading all at once
    const batch = await vectorDb.vectors
      .orderBy("metadata.timestamp")
      .offset(offset)
      .limit(batchSize)
      .toArray()

    if (batch.length === 0) {
      hasMore = false
      break
    }

    for (const doc of batch) {
      const size = estimateStorageSize(doc)
      totalSize += size
      if (doc.id) {
        sizes.push({
          id: doc.id,
          size,
          timestamp: doc.metadata.timestamp
        })
      }
    }

    // Yield to main thread every batch
    await new Promise((resolve) => setTimeout(resolve, 0))

    // If we're over limit, stop loading more and start cleanup
    if (totalSize > maxSizeBytes) {
      hasMore = false
      break
    }

    offset += batchSize
  }

  // If over limit, delete oldest vectors
  if (totalSize > maxSizeBytes) {
    // Sort by timestamp (oldest first)
    sizes.sort((a, b) => a.timestamp - b.timestamp)

    // Delete oldest vectors until under limit
    for (const item of sizes) {
      if (totalSize <= maxSizeBytes) break
      await vectorDb.vectors.delete(item.id)
      totalSize -= item.size

      // Yield periodically to avoid blocking
      if (sizes.indexOf(item) % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
  }
}

/**
 * Stores a document with its embedding in the vector database
 * Optimized with storage limit checking and auto-cleanup
 * Includes deduplication check to prevent storing duplicate content
 */
export const storeVector = async (
  content: string,
  embedding: number[],
  metadata: VectorDocument["metadata"]
): Promise<number> => {
  const config = await getEmbeddingConfig()

  // Check for duplicate content in the same context (sessionId/fileId/url)
  // This prevents storing the same content multiple times
  if (metadata.sessionId) {
    const existing = await vectorDb.vectors
      .where("metadata.sessionId")
      .equals(metadata.sessionId)
      .filter((doc) => doc.content === content)
      .first()

    if (existing) {
      // Return existing ID instead of creating duplicate
      return existing.id || 0
    }
  }

  // Check file limits
  if (config.maxEmbeddingsPerFile > 0 && metadata.fileId) {
    const fileVectors = await vectorDb.vectors
      .where("metadata.fileId")
      .equals(metadata.fileId)
      .count()

    if (fileVectors >= config.maxEmbeddingsPerFile) {
      throw new Error(
        `Maximum embeddings per file (${config.maxEmbeddingsPerFile}) reached`
      )
    }
  }

  // Auto-cleanup if enabled
  if (config.autoCleanup) {
    const cutoffDate = Date.now() - config.cleanupDaysOld * 24 * 60 * 60 * 1000
    await vectorDb.vectors
      .where("metadata.timestamp")
      .below(cutoffDate)
      .delete()
  }

  // Normalize embedding for faster similarity searches
  const { normalized, norm } = normalizeVector(embedding)

  const id = await vectorDb.vectors.add({
    content,
    embedding,
    normalizedEmbedding: normalized,
    norm,
    metadata
  })

  // Check storage limits
  await checkStorageLimit()

  return id
}

/**
 * Searches for similar documents using cosine similarity
 * Optimized with:
 * - Pre-normalized embeddings and Float32Array
 * - Early termination for low similarity scores
 * - Search result caching
 * - Configurable limits and efficient filtering
 * - Non-blocking computation
 */
export const searchSimilarVectors = async (
  queryEmbedding: number[],
  options: {
    limit?: number
    minSimilarity?: number
    type?: VectorDocument["metadata"]["type"]
    sessionId?: string
    fileId?: string | string[]
  } = {}
): Promise<SearchResult[]> => {
  const config = await getEmbeddingConfig()
  const {
    limit = config.defaultSearchLimit,
    minSimilarity = config.defaultMinSimilarity,
    type,
    sessionId,
    fileId
  } = options

  // Check cache first
  const cacheKey = hashSearchQuery(queryEmbedding, options)
  const cached = searchCache.get(cacheKey)
  const { ttl } = await getCacheConfig()
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.results
  }

  // Normalize query embedding once
  const { normalized: queryNormalized, norm: queryNorm } =
    normalizeVector(queryEmbedding)

  let query: Dexie.Collection<VectorDocument, number>

  // Use indexed queries when possible for better performance
  if (type) {
    query = vectorDb.vectors.where("metadata.type").equals(type)
  } else if (sessionId) {
    query = vectorDb.vectors.where("metadata.sessionId").equals(sessionId)
  } else if (fileId && !Array.isArray(fileId)) {
    query = vectorDb.vectors.where("metadata.fileId").equals(fileId)
  } else {
    query = vectorDb.vectors.toCollection()
  }

  // Apply additional filters
  if (type && sessionId) {
    query = query.filter((v) => v.metadata.sessionId === sessionId)
  }
  if (fileId) {
    if (Array.isArray(fileId)) {
      query = query.filter(
        (v) => v.metadata.fileId && fileId.includes(v.metadata.fileId)
      )
    } else {
      query = query.filter((v) => v.metadata.fileId === fileId)
    }
  }

  const documents = await query.toArray()

  // For large datasets, process in chunks to avoid blocking main thread
  const CHUNK_SIZE = 100
  const results: SearchResult[] = []

  for (let i = 0; i < documents.length; i += CHUNK_SIZE) {
    const chunk = documents.slice(i, i + CHUNK_SIZE)

    // Calculate similarities for this chunk with optimizations
    const chunkResults: SearchResult[] = []

    for (const doc of chunk) {
      // Use optimized similarity calculation
      const similarity = cosineSimilarityOptimized(
        queryNormalized,
        queryNorm,
        doc.embedding,
        doc.norm,
        doc.normalizedEmbedding
      )

      // Early termination: skip if below threshold
      // This saves computation time by not storing low-similarity results
      if (similarity >= minSimilarity) {
        chunkResults.push({
          document: doc,
          similarity
        })
      }
    }

    results.push(...chunkResults)

    // Yield to main thread every chunk to prevent blocking
    if (i + CHUNK_SIZE < documents.length) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  // Sort and limit results
  const sortedResults = results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)

  // Cache results
  await cleanSearchCache()
  searchCache.set(cacheKey, {
    results: sortedResults,
    timestamp: Date.now()
  })

  return sortedResults
}

/**
 * Deletes vectors by metadata filters
 */
export const deleteVectors = async (filters: {
  type?: VectorDocument["metadata"]["type"]
  sessionId?: string
  fileId?: string
  url?: string
}): Promise<number> => {
  const { type, sessionId, fileId, url } = filters

  let query = vectorDb.vectors.toCollection()

  if (type) {
    query = query.filter((v) => v.metadata.type === type)
  }
  if (sessionId) {
    query = query.filter((v) => v.metadata.sessionId === sessionId)
  }
  if (fileId) {
    query = query.filter((v) => v.metadata.fileId === fileId)
  }
  if (url) {
    query = query.filter((v) => v.metadata.url === url)
  }

  return await query.delete()
}

/**
 * Gets all vectors for a specific context (e.g., all chunks of a file)
 */
export const getVectorsByContext = async (context: {
  type?: VectorDocument["metadata"]["type"]
  sessionId?: string
  fileId?: string
  url?: string
}): Promise<VectorDocument[]> => {
  let query = vectorDb.vectors.toCollection()

  if (context.type) {
    query = query.filter((v) => v.metadata.type === context.type)
  }
  if (context.sessionId) {
    query = query.filter((v) => v.metadata.sessionId === context.sessionId)
  }
  if (context.fileId) {
    query = query.filter((v) => v.metadata.fileId === context.fileId)
  }
  if (context.url) {
    query = query.filter((v) => v.metadata.url === context.url)
  }

  return await query.sortBy("metadata.timestamp")
}

/**
 * Gets storage statistics
 * Optimized to process in batches to avoid blocking main thread
 */
export const getStorageStats = async (): Promise<{
  totalVectors: number
  totalSizeMB: number
  byType: Record<string, number>
}> => {
  // Get count first (fast operation)
  const totalVectors = await vectorDb.vectors.count()

  // Process in batches to avoid loading all vectors into memory
  let totalSize = 0
  const byType: Record<string, number> = {}

  const batchSize = 500
  let offset = 0
  let processed = 0

  while (processed < totalVectors) {
    const batch = await vectorDb.vectors
      .offset(offset)
      .limit(batchSize)
      .toArray()

    if (batch.length === 0) break

    for (const doc of batch) {
      totalSize += estimateStorageSize(doc)
      const type = doc.metadata.type
      byType[type] = (byType[type] || 0) + 1
    }

    processed += batch.length
    offset += batchSize

    // Yield to main thread every batch
    if (processed < totalVectors) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  return {
    totalVectors,
    totalSizeMB: totalSize / (1024 * 1024),
    byType
  }
}

/**
 * Clears all vectors from the database
 * Optionally filters by type to clear only specific types
 */
export const clearAllVectors = async (
  type?: VectorDocument["metadata"]["type"]
): Promise<number> => {
  if (type) {
    return await deleteVectors({ type })
  }
  const count = await vectorDb.vectors.count()
  await vectorDb.vectors.clear()
  return count
}

/**
 * Removes duplicate vectors keeping only the first occurrence
 * Duplicates are identified by same content within the same sessionId/fileId/url
 * Returns the number of duplicates removed
 */
export const removeDuplicateVectors = async (): Promise<{
  removed: number
  kept: number
}> => {
  let removed = 0
  let kept = 0

  // Process in batches to avoid loading all vectors into memory
  const batchSize = 500
  let offset = 0
  let hasMore = true

  // Track seen content per context
  const seenContent = new Map<string, number>()

  while (hasMore) {
    const batch = await vectorDb.vectors
      .offset(offset)
      .limit(batchSize)
      .toArray()

    if (batch.length === 0) {
      hasMore = false
      break
    }

    for (const doc of batch) {
      if (!doc.id) continue

      // Create a unique key for this content in its context
      const contextKey = doc.metadata.sessionId
        ? `${doc.metadata.sessionId}:${doc.content}`
        : doc.metadata.fileId
          ? `${doc.metadata.fileId}:${doc.content}`
          : doc.metadata.url
            ? `${doc.metadata.url}:${doc.content}`
            : doc.content

      if (seenContent.has(contextKey)) {
        // Duplicate found - delete it
        await vectorDb.vectors.delete(doc.id)
        removed++
      } else {
        // First occurrence - keep it
        seenContent.set(contextKey, doc.id)
        kept++
      }
    }

    offset += batchSize

    // Yield to main thread every batch
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return { removed, kept }
}
