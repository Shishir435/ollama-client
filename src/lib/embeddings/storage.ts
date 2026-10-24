import { EmbeddingService } from "@/application/embeddings/embedding-service"
import { hnswIndexManager } from "@/lib/embeddings/hnsw-index"
import { keywordIndexManager } from "@/lib/embeddings/keyword-index"
import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { getEmbeddingConfig } from "./config"
import { vectorDb } from "./db"
import { normalizeVector } from "./math"
import {
  fenceMessageVectors,
  fenceSessionVectors,
  messageChunkIdentity
} from "./message-revisions"
import { BUNDLED_MODEL } from "./native/constants"
import { readNativeIndexState } from "./native/state"
import type { VectorDocument } from "./types"
import { matchesVectorType } from "./types"
import {
  applyVectorStorageChanges,
  emptyVectorStorageStats,
  estimateVectorStorageSize,
  VECTOR_STORAGE_STATS_ID
} from "./vector-storage-stats"

export const estimateStorageSize = estimateVectorStorageSize

const deleteVectorIds = async (ids: number[]): Promise<VectorDocument[]> => {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return []

  return vectorDb.transaction(
    "rw",
    vectorDb.vectors,
    vectorDb.vectorStats,
    async () => {
      const existing = (await vectorDb.vectors.bulkGet(uniqueIds)).filter(
        (doc): doc is VectorDocument => doc !== undefined
      )
      const existingIds = existing
        .map((doc) => doc.id)
        .filter((id): id is number => id !== undefined)
      if (existingIds.length > 0) {
        await vectorDb.vectors.bulkDelete(existingIds)
        await applyVectorStorageChanges(
          vectorDb.vectorStats,
          existing.map((before) => ({ before }))
        )
      }
      return existing
    }
  )
}

/**
 * Checks and enforces storage limits
 * Optimized to avoid loading all vectors into memory at once
 */
export const checkStorageLimit = async (): Promise<void> => {
  const config = await getEmbeddingConfig()
  if (config.maxStorageSize === 0) return // Unlimited

  const maxSizeBytes = config.maxStorageSize * 1024 * 1024 // Convert MB to bytes
  let deletedIds: number[] = []

  for (;;) {
    const deleted = await deleteOldestVectorsOverLimit(maxSizeBytes)
    if (deleted.length === 0) break
    deletedIds.push(...deleted.flatMap((doc) => (doc.id ? [doc.id] : [])))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  await removeVectorIdsFromIndexes(deletedIds)
}

/** Delete only enough oldest rows to bring the maintained total under quota. */
const deleteOldestVectorsOverLimit = async (
  maxSizeBytes: number
): Promise<VectorDocument[]> =>
  vectorDb.transaction(
    "rw",
    [vectorDb.vectors, vectorDb.vectorStats],
    async () => {
      const stats = await vectorDb.vectorStats.get(VECTOR_STORAGE_STATS_ID)
      if ((stats?.totalBytes ?? 0) <= maxSizeBytes) return []

      const oldest = await vectorDb.vectors
        .orderBy("metadata.timestamp")
        .limit(100)
        .toArray()
      const selected: VectorDocument[] = []
      let remainingBytes = stats?.totalBytes ?? 0
      for (const document of oldest) {
        if (remainingBytes <= maxSizeBytes) break
        selected.push(document)
        remainingBytes -= estimateVectorStorageSize(document)
      }
      const ids = selected
        .map((document) => document.id)
        .filter((id): id is number => id !== undefined)
      if (ids.length === 0) return []

      await vectorDb.vectors.bulkDelete(ids)
      await applyVectorStorageChanges(
        vectorDb.vectorStats,
        selected.map((before) => ({ before }))
      )
      return selected
    }
  )

const removeVectorIdsFromIndexes = async (ids: number[]): Promise<void> => {
  if (ids.length === 0) return
  for (const id of ids) {
    keywordIndexManager.removeDocument(id)
  }
  // HNSW has no per-id removal. Invalidate it now; a later unscoped search can
  // rebuild it on demand if that search path is enabled.
  await hnswIndexManager.invalidateAfterDeletion().catch((error) => {
    logger.warn(
      "Vector index invalidation after deletion failed",
      "removeVectorIdsFromIndexes",
      { error }
    )
  })
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
  const resolvedMetadata: VectorDocument["metadata"] = {
    ...metadata,
    embeddingDim: metadata.embeddingDim ?? embedding.length
  }

  // Check for duplicate content in the same context (sessionId/fileId/url)
  // This prevents storing the same content multiple times
  if (resolvedMetadata.sessionId && resolvedMetadata.messageId === undefined) {
    const existing = await vectorDb.vectors
      .where("metadata.sessionId")
      .equals(resolvedMetadata.sessionId)
      .filter((doc) => {
        // If messageId is provided, check that too
        if (resolvedMetadata.messageId && doc.metadata.messageId) {
          return doc.metadata.messageId === resolvedMetadata.messageId
        }
        return doc.content === content
      })
      .first()

    // Optimization: If messageId is present, we can query by it directly if we had a compound index or just check it first?
    // Current schema: messageId is indexed.
    // So we can do:
    if (!existing && resolvedMetadata.messageId) {
      // Double check by messageId directly to be sure
      const existingById = await vectorDb.vectors
        .where("metadata.messageId")
        .equals(resolvedMetadata.messageId)
        .first()
      if (existingById) return existingById.id || 0
    }

    if (existing) {
      // Return existing ID instead of creating duplicate
      return existing.id || 0
    }
  }

  // Check file limits
  if (config.maxEmbeddingsPerFile > 0 && resolvedMetadata.fileId) {
    const fileVectors = await vectorDb.vectors
      .where("metadata.fileId")
      .equals(resolvedMetadata.fileId)
      .count()

    if (fileVectors >= config.maxEmbeddingsPerFile) {
      throw createAppError(
        `Maximum embeddings per file (${config.maxEmbeddingsPerFile}) reached`,
        { kind: "validation" }
      )
    }
  }

  // Auto-cleanup if enabled
  if (config.autoCleanup) {
    const cutoffDate = Date.now() - config.cleanupDaysOld * 24 * 60 * 60 * 1000
    const expiredIds = await vectorDb.vectors
      .where("metadata.timestamp")
      .below(cutoffDate)
      .primaryKeys()
    if (expiredIds.length > 0) {
      const deleted = await deleteVectorIds(expiredIds)
      await removeVectorIdsFromIndexes(
        deleted.flatMap((doc) => (doc.id ? [doc.id] : []))
      )
    }
  }

  // Normalize embedding for faster similarity searches
  const { normalized, norm } = normalizeVector(embedding)

  const id = await vectorDb.transaction(
    "rw",
    [
      vectorDb.vectors,
      vectorDb.embeddingState,
      vectorDb.messageState,
      vectorDb.deletedSessions,
      vectorDb.vectorStats
    ],
    async () => {
      if (
        resolvedMetadata.type === "chat" &&
        resolvedMetadata.sessionId &&
        (await vectorDb.deletedSessions.get(resolvedMetadata.sessionId))
      )
        return 0
      if (resolvedMetadata.messageId !== undefined) {
        const owner = await vectorDb.messageState.get(
          resolvedMetadata.messageId
        )
        if (
          !owner ||
          owner.deleted ||
          !resolvedMetadata.messageRevision ||
          owner.revision !== resolvedMetadata.messageRevision ||
          owner.token !== resolvedMetadata.messageIndexToken
        )
          return 0
        const identity = messageChunkIdentity(resolvedMetadata)
        const existing = await vectorDb.vectors
          .where("metadata.messageId")
          .equals(resolvedMetadata.messageId)
          .filter((doc) => messageChunkIdentity(doc.metadata) === identity)
          .first()
        if (existing?.id !== undefined) return existing.id
      }
      const state = await readNativeIndexState()
      if (
        (state.mode === "bundled" &&
          resolvedMetadata.embeddingModel !== BUNDLED_MODEL) ||
        (state.mode === "external" &&
          resolvedMetadata.embeddingModel === BUNDLED_MODEL)
      )
        throw new Error("Embedding selection changed. Please retry indexing.")
      const document: VectorDocument = {
        content,
        embedding,
        normalizedEmbedding: normalized,
        norm,
        metadata: resolvedMetadata
      }
      const id = await vectorDb.vectors.add(document)
      await applyVectorStorageChanges(vectorDb.vectorStats, [
        { after: { ...document, id } }
      ])
      return id
    }
  )
  if (id === 0) return 0

  // Add to keyword index for full-text search
  keywordIndexManager.addDocument(id, content, {
    id,
    content,
    embedding,
    normalizedEmbedding: normalized,
    norm,
    metadata: resolvedMetadata
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
  source?: string
  sessionId?: string
  fileId?: string
  url?: string
  messageId?: number
}): Promise<number> => {
  const { type, source, sessionId, fileId, url, messageId } = filters

  let query = vectorDb.vectors.toCollection()

  if (type) {
    query = query.filter((v) => matchesVectorType(v.metadata.type, type))
  }
  if (source) {
    query = query.filter((v) => v.metadata.source === source)
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
  const matches = await query.toArray()
  if (type === "chat" && !sessionId && messageId === undefined) {
    const states = await vectorDb.messageState.toArray()
    await fenceMessageVectors(
      states.map((state) => state.messageId),
      "cleared"
    )
  }
  if (sessionId && type === "chat") await fenceSessionVectors(sessionId)
  const messageIds =
    messageId !== undefined
      ? [messageId]
      : matches.flatMap((doc) =>
          doc.metadata.messageId !== undefined ? [doc.metadata.messageId] : []
        )
  if (messageIds.length)
    await fenceMessageVectors(
      [...new Set(messageIds)],
      type === "chat" && !sessionId && messageId === undefined
        ? "cleared"
        : "deleted"
    )
  const ids = matches
    .map((doc) => doc.id)
    .filter((id): id is number => id !== undefined)
  if (ids.length > 0) {
    await deleteVectorIds(ids)
    // Fencing may have removed these rows before the stats-aware delete ran,
    // but the IDs still need to leave the in-memory search indexes.
    await removeVectorIdsFromIndexes(ids)
  }

  return matches.length
}

/** Removes matching pre-message-id chat rows through the stats-aware path. */
export const removeLegacyChatVectors = async (
  sessionId: string,
  content: string
): Promise<number> => {
  const legacy = await vectorDb.vectors
    .where("metadata.sessionId")
    .equals(sessionId)
    .filter((doc) => doc.content === content && !doc.metadata.messageId)
    .toArray()
  const ids = legacy.flatMap((vector) =>
    vector.id === undefined ? [] : [vector.id]
  )
  const deleted = await deleteVectorIds(ids)
  await removeVectorIdsFromIndexes(
    deleted.flatMap((vector) => (vector.id === undefined ? [] : [vector.id]))
  )
  return deleted.length
}

/**
 * Gets storage statistics
 */
export const getStorageStats = async (): Promise<{
  totalVectors: number
  totalSizeMB: number
  byType: Record<string, number>
}> => {
  const stats =
    (await vectorDb.vectorStats.get(VECTOR_STORAGE_STATS_ID)) ??
    emptyVectorStorageStats()
  return {
    totalVectors: stats.totalVectors,
    totalSizeMB: stats.totalBytes / (1024 * 1024),
    byType: stats.byType
  }
}

/**
 * Gets embedding dimension statistics for health checks
 */
export const getEmbeddingDimensionStats = async (): Promise<{
  totalVectors: number
  byDimension: Record<string, number>
  mixedDimensions: boolean
  dominantDimension: number | null
}> => {
  const byDimension: Record<string, number> = {}
  let totalVectors = 0

  await vectorDb.vectors.each((doc) => {
    totalVectors += 1
    const dimension = doc.metadata?.embeddingDim ?? doc.embedding.length
    if (!dimension) return
    const key = String(dimension)
    byDimension[key] = (byDimension[key] || 0) + 1
  })

  const dimensionEntries = Object.entries(byDimension)
  const dominantEntry =
    dimensionEntries.length > 0
      ? dimensionEntries.reduce(
          (acc, entry) => (entry[1] > acc[1] ? entry : acc),
          dimensionEntries[0]
        )
      : null

  return {
    totalVectors,
    byDimension,
    mixedDimensions: dimensionEntries.length > 1,
    dominantDimension: dominantEntry ? Number(dominantEntry[0]) : null
  }
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
    query = query.filter((v) => matchesVectorType(v.metadata.type, type))
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
  await fenceMessageVectors(
    (await vectorDb.messageState.toArray()).map((state) => state.messageId),
    "cleared"
  )
  await vectorDb.transaction(
    "rw",
    vectorDb.vectors,
    vectorDb.vectorStats,
    async () => {
      const count = await vectorDb.vectors.count()
      await vectorDb.vectors.clear()
      await vectorDb.vectorStats.put(emptyVectorStorageStats())
      return count
    }
  )

  // Clear indexes
  keywordIndexManager.clear()
  void hnswIndexManager.clearIndex().catch((error) => {
    logger.warn("Failed to clear HNSW index", "clearAllVectors", { error })
  })

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
    const key =
      doc.metadata.messageId !== undefined
        ? messageChunkIdentity(doc.metadata)
        : `${doc.content}:${doc.metadata.sessionId || ""}:${doc.metadata.fileId || ""}:${doc.metadata.url || ""}`

    if (uniqueKeys.has(key)) {
      duplicates.push(doc.id)
    } else {
      uniqueKeys.add(key)
    }
  }

  if (duplicates.length > 0) {
    const deleted = await deleteVectorIds(duplicates)
    await removeVectorIdsFromIndexes(
      deleted.flatMap((doc) => (doc.id ? [doc.id] : []))
    )
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
      if (!matchesVectorType(doc.metadata.type, type)) return false
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
      timestamp?: number
    }
  }>,
  fileId?: string,
  options: {
    signal?: AbortSignal
    strict?: boolean
    onStored?: (stored: number, total: number) => void
  } = {}
): Promise<number[]> => {
  const ids: number[] = []

  // Process sequentially to ensure storage limits are respected incrementally
  // and to avoid overwhelming the DB/Index
  for (const doc of documents) {
    try {
      options.signal?.throwIfAborted()
      const embeddingResult = await EmbeddingService.generate(
        doc.pageContent,
        undefined,
        undefined,
        options.signal ? { signal: options.signal } : {}
      )
      options.signal?.throwIfAborted()

      if ("error" in embeddingResult) {
        logger.error(
          "Failed to generate embedding for document chunk",
          "fromDocuments",
          {
            error: embeddingResult.error
          }
        )
        if (options.strict) {
          throw createAppError(embeddingResult.error, { kind: "provider" })
        }
        continue
      }

      const metadata: VectorDocument["metadata"] = {
        ...doc.metadata,
        type: doc.metadata.type || "file",
        timestamp: doc.metadata.timestamp ?? Date.now(),
        fileId: fileId || doc.metadata.fileId,
        embeddingModel: embeddingResult.model,
        embeddingProviderId: embeddingResult.providerId,
        embeddingDim: embeddingResult.embedding.length
      }

      const id = await storeVector(
        doc.pageContent,
        embeddingResult.embedding,
        metadata
      )
      ids.push(id)
      options.onStored?.(ids.length, documents.length)
    } catch (error) {
      if (options.signal?.aborted || options.strict) throw error
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
    role: "user" | "assistant" | "system" | "tool"
    sessionId: string
    chatId?: string
    title?: string
    messageId?: number
  },
  signal?: AbortSignal
): Promise<number> => {
  try {
    signal?.throwIfAborted()
    const embeddingResult = await EmbeddingService.generate(
      content,
      undefined,
      undefined,
      signal ? { signal } : {}
    )

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

    signal?.throwIfAborted()
    return storeVector(content, embeddingResult.embedding, {
      ...metadata,
      type: "chat",
      source: "chat",
      timestamp: Date.now(),
      embeddingModel: embeddingResult.model,
      embeddingProviderId: embeddingResult.providerId,
      embeddingDim: embeddingResult.embedding.length
    })
  } catch (error) {
    logger.error("Failed to store chat message", "storeChatMessage", { error })
    return 0
  }
}
