import Dexie, { type Table } from "dexie"
import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cosineSimilarity } from "./ollama-embedder"

export interface VectorDocument {
  id?: number
  content: string
  embedding: number[]
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
  const contentSize = new Blob([doc.content]).size
  const metadataSize = JSON.stringify(doc.metadata).length
  return embeddingSize + contentSize + metadataSize + 100 // +100 for overhead
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
 */
export const storeVector = async (
  content: string,
  embedding: number[],
  metadata: VectorDocument["metadata"]
): Promise<number> => {
  const config = await getEmbeddingConfig()

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

  const id = await vectorDb.vectors.add({
    content,
    embedding,
    metadata
  })

  // Check storage limits
  await checkStorageLimit()

  return id
}

/**
 * Searches for similar documents using cosine similarity
 * Optimized with configurable limits, efficient filtering, and non-blocking computation
 */
export const searchSimilarVectors = async (
  queryEmbedding: number[],
  options: {
    limit?: number
    minSimilarity?: number
    type?: VectorDocument["metadata"]["type"]
    sessionId?: string
    fileId?: string
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

  let query: Dexie.Collection<VectorDocument, number>

  // Use indexed queries when possible for better performance
  if (type) {
    query = vectorDb.vectors.where("metadata.type").equals(type)
  } else if (sessionId) {
    query = vectorDb.vectors.where("metadata.sessionId").equals(sessionId)
  } else if (fileId) {
    query = vectorDb.vectors.where("metadata.fileId").equals(fileId)
  } else {
    query = vectorDb.vectors.toCollection()
  }

  // Apply additional filters
  if (type && sessionId) {
    query = query.filter((v) => v.metadata.sessionId === sessionId)
  }
  if (fileId && type) {
    query = query.filter((v) => v.metadata.fileId === fileId)
  }

  const documents = await query.toArray()

  // For large datasets, process in chunks to avoid blocking main thread
  const CHUNK_SIZE = 100
  const results: SearchResult[] = []

  for (let i = 0; i < documents.length; i += CHUNK_SIZE) {
    const chunk = documents.slice(i, i + CHUNK_SIZE)

    // Calculate similarities for this chunk
    const chunkResults: SearchResult[] = chunk
      .map((doc) => ({
        document: doc,
        similarity: cosineSimilarity(queryEmbedding, doc.embedding)
      }))
      .filter((result) => result.similarity >= minSimilarity)

    results.push(...chunkResults)

    // Yield to main thread every chunk to prevent blocking
    if (i + CHUNK_SIZE < documents.length) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  // Sort and limit results
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit)
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
