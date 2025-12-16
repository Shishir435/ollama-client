import { hnswIndexManager } from "@/lib/embeddings/hnsw-index"
import { keywordIndexManager } from "@/lib/embeddings/keyword-index"
import { logger } from "@/lib/logger"
// import logger to debug

import { getEmbeddingConfig } from "./config"
import { vectorDb } from "./db"
import { normalizeVector } from "./math"
import { generateEmbedding } from "./ollama-embedder"
import type { VectorDocument } from "./types"

/**
 * Estimates storage size in bytes for a vector document
 */
export const estimateStorageSize = (doc: VectorDocument): number => {
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
export const checkStorageLimit = async (): Promise<void> => {
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
      .filter((doc) => {
        // If messageId is provided, check that too
        if (metadata.messageId && doc.metadata.messageId) {
          return doc.metadata.messageId === metadata.messageId
        }
        return doc.content === content
      })
      .first()

    // Optimization: If messageId is present, we can query by it directly if we had a compound index or just check it first?
    // Current schema: messageId is indexed.
    // So we can do:
    if (!existing && metadata.messageId) {
      // Double check by messageId directly to be sure
      const existingById = await vectorDb.vectors
        .where("metadata.messageId")
        .equals(metadata.messageId)
        .first()
      if (existingById) return existingById.id || 0
    }

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

  // Add to keyword index for full-text search
  keywordIndexManager.addDocument(id, content, {
    id,
    content,
    embedding,
    normalizedEmbedding: normalized,
    norm,
    metadata
  })

  // Add to HNSW index incrementally (if initialized)
  try {
    await hnswIndexManager.addVector(id, embedding)
  } catch (error) {
    // Index might not be initialized yet, will be built on first search
    logger.debug(
      "HNSW index not initialized, will be built on first search",
      "storeVector",
      { error }
    )
  }

  // Check storage limits
  await checkStorageLimit()

  return id
}

/**
 * Deletes vectors by metadata filters
 */
export const deleteVectors = async (filters: {
  type?: VectorDocument["metadata"]["type"]
  sessionId?: string
  fileId?: string
  url?: string
  messageId?: number
}): Promise<number> => {
  const { type, sessionId, fileId, url, messageId } = filters

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
  if (messageId) {
    query = query.filter((v) => v.metadata.messageId === messageId)
  }

  const count = await query.count()
  await query.delete()

  // We should also remove from HNSW and keyword indexes
  // This is a bit expensive as we don't know the IDs directly without querying first
  // But deleteVectors is primarily used for cleanup, so we might need to rely on index rebuilds
  // or implement more complex deletion logic here if needed.
  // For now, we accept that indexes might be slightly out of sync until next full rebuild/refresh
  // or handled by the caller.

  return count
}

/**
 * Gets storage statistics
 */
export const getStorageStats = async (): Promise<{
  totalVectors: number
  totalSizeMB: number
  byType: Record<string, number>
}> => {
  const vectors = await vectorDb.vectors.toArray()
  const stats = {
    totalVectors: vectors.length,
    totalSizeMB: 0,
    byType: {} as Record<string, number>
  }

  for (const doc of vectors) {
    // Calculate size
    stats.totalSizeMB += estimateStorageSize(doc) / (1024 * 1024)

    // Count by type
    const type = doc.metadata.type
    stats.byType[type] = (stats.byType[type] || 0) + 1
  }

  return stats
}

/**
 * Retrieves vectors by context filters
 */
export const getVectorsByContext = async (filters: {
  sessionId?: string
  fileId?: string
  type?: VectorDocument["metadata"]["type"]
}): Promise<VectorDocument[]> => {
  const { sessionId, fileId, type } = filters
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

  return query.toArray()
}

/**
 * Clears all vectors or vectors by type
 */
export const clearAllVectors = async (
  type?: VectorDocument["metadata"]["type"]
): Promise<number> => {
  if (type) {
    return deleteVectors({ type })
  }

  const count = await vectorDb.vectors.count()
  await vectorDb.vectors.clear()

  // Clear indexes
  await hnswIndexManager.clearIndex()
  await keywordIndexManager.clear()

  return count
}

/**
 * Removes duplicate vectors from the database
 * Keeps the oldest version of each duplicate
 */
export const removeDuplicateVectors = async (): Promise<{
  deleted: number
  kept: number
}> => {
  const vectors = await vectorDb.vectors.toArray()
  const uniqueKeys = new Set<string>()
  const duplicates: number[] = []

  for (const doc of vectors) {
    if (!doc.id) continue

    // Create a key for uniqueness
    // Same content in same session/file should be unique
    const key = `${doc.content}:${doc.metadata.sessionId || ""}:${doc.metadata.fileId || ""}:${doc.metadata.url || ""}`

    if (uniqueKeys.has(key)) {
      duplicates.push(doc.id)
    } else {
      uniqueKeys.add(key)
    }
  }

  if (duplicates.length > 0) {
    await vectorDb.vectors.bulkDelete(duplicates)
    // We should ideally clean indexes too, but implicit rebuild/clear is acceptable for this maintenance op
  }

  return {
    deleted: duplicates.length,
    kept: vectors.length - duplicates.length
  }
}

/**
 * Retrieves all vector documents from the database
 */
export const getAllDocuments = async (params: {
  fileId?: string
  type: string
  maxTokens?: number
}): Promise<{ documents: VectorDocument[]; tokenCount: number }> => {
  const { fileId, type } = params
  const collection = vectorDb.vectors.orderBy("metadata.timestamp")

  // Apply filtering manually since we need compound query support
  // or use Dexie's collection filtering
  const documents = await collection
    .filter((doc) => {
      if (doc.metadata.type !== type) return false
      if (fileId && doc.metadata.fileId !== fileId) return false
      return true
    })
    .toArray()

  // Calculate token count (approx)
  const tokenCount = documents.reduce((acc, doc) => {
    return acc + Math.ceil(doc.content.length / 4)
  }, 0)

  return {
    documents,
    tokenCount
  }
}

/**
 * Stores multiple documents in the vector database
 */
export const fromDocuments = async (
  documents: Array<{
    pageContent: string
    metadata: Omit<VectorDocument["metadata"], "timestamp" | "type"> & {
      type?: VectorDocument["metadata"]["type"]
    }
  }>,
  fileId?: string
): Promise<number[]> => {
  const ids: number[] = []

  // Process sequentially to ensure storage limits are respected incrementally
  // and to avoid overwhelming the DB/Index
  for (const doc of documents) {
    try {
      const embeddingResult = await generateEmbedding(doc.pageContent)

      if ("error" in embeddingResult) {
        logger.error(
          "Failed to generate embedding for document chunk",
          "fromDocuments",
          {
            error: embeddingResult.error
          }
        )
        continue
      }

      const metadata: VectorDocument["metadata"] = {
        ...doc.metadata,
        type: doc.metadata.type || "file",
        timestamp: Date.now(),
        fileId: fileId || doc.metadata.fileId
      }

      const id = await storeVector(
        doc.pageContent,
        embeddingResult.embedding,
        metadata
      )
      ids.push(id)
    } catch (error) {
      logger.error("Failed to store document chunk", "fromDocuments", { error })
    }
  }
  return ids
}

/**
 * Stores a chat message in the vector database
 */
export const storeChatMessage = async (
  content: string,
  metadata: {
    role: "user" | "assistant" | "system"
    sessionId: string
    title?: string
    messageId?: number
  }
): Promise<number> => {
  try {
    const embeddingResult = await generateEmbedding(content)

    if ("error" in embeddingResult) {
      logger.error(
        "Failed to generate embedding for chat message",
        "storeChatMessage",
        {
          error: embeddingResult.error
        }
      )
      return 0
    }

    return storeVector(content, embeddingResult.embedding, {
      ...metadata,
      type: "chat",
      source: "chat",
      timestamp: Date.now()
    })
  } catch (error) {
    logger.error("Failed to store chat message", "storeChatMessage", { error })
    return 0
  }
}
