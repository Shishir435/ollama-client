import type Dexie from "dexie"
import { hnswIndexManager } from "@/lib/embeddings/hnsw-index"
import { keywordIndexManager } from "@/lib/embeddings/keyword-index"
import { logger } from "@/lib/logger"
import {
  cleanSearchCache,
  getCacheConfig,
  hashSearchQuery,
  searchCache
} from "./cache"
import { getEmbeddingConfig } from "./config"
import { vectorDb } from "./db"
import { generateEmbedding } from "./embedding-client"
import { cosineSimilarityOptimized, normalizeVector } from "./math"
import type { SearchResult, VectorDocument } from "./types"

const HNSW_REBUILD_COOLDOWN_MS = 30000
let lastHnswRebuildAttempt: { dimension: number; timestamp: number } | null =
  null

/**
 * Search using HNSW index
 */
async function searchWithHNSW(
  queryEmbedding: number[],
  limit: number,
  minSimilarity: number,
  query: Dexie.Collection<VectorDocument, number>
): Promise<SearchResult[]> {
  // Get HNSW results (returns IDs and distances)
  const hnswResults = await hnswIndexManager.search(queryEmbedding, limit * 2) // Get more candidates

  // Get matching documents from filtered query
  const documents = await query.toArray()
  const docMap = new Map(
    documents
      .filter((d): d is VectorDocument & { id: number } => d.id !== undefined)
      .map((d) => [d.id, d])
  )

  // Map HNSW results to SearchResults with filtering
  const results: SearchResult[] = []
  for (const { id, distance } of hnswResults) {
    const doc = docMap.get(id)
    if (doc && distance >= minSimilarity) {
      results.push({
        document: doc,
        similarity: distance
      })
    }
  }

  // Sort by similarity and limit
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit)
}

/**
 * Search using brute-force cosine similarity
 */
async function searchBruteForce(
  queryEmbedding: number[],
  limit: number,
  minSimilarity: number,
  query: Dexie.Collection<VectorDocument, number>
): Promise<SearchResult[]> {
  // Normalize query embedding once
  const { normalized: queryNormalized, norm: queryNorm } =
    normalizeVector(queryEmbedding)

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
      if (doc.embedding.length !== queryNormalized.length) {
        continue
      }

      const similarity = cosineSimilarityOptimized(
        queryNormalized,
        queryNorm,
        doc.embedding,
        doc.norm,
        doc.normalizedEmbedding
      )

      // Early termination: skip if below threshold
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
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit)
}

/**
 * Searches for similar vectors using HNSW or brute-force cosine similarity.
 * Automatically decides the strategy based on data size and backend availability.
 * Incorporates results from the HNSW graph if populated, otherwise scans the DB sequentially.
 * Results are cached to minimize redundant embedding and DB lookups.
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
    logger.info("Returning cached search results", "searchSimilarVectors")
    return cached.results
  }

  const startTime = performance.now()

  // Get total vector count for strategy decision
  let vectorQuery: Dexie.Collection<VectorDocument, number> = type
    ? vectorDb.vectors.where("metadata.type").equals(type)
    : sessionId
      ? vectorDb.vectors.where("metadata.sessionId").equals(sessionId)
      : fileId && !Array.isArray(fileId)
        ? vectorDb.vectors.where("metadata.fileId").equals(fileId)
        : vectorDb.vectors.toCollection()

  // Apply filters to collection if needed (for toCollection case or additional filters)
  if (sessionId && !type) {
    vectorQuery = vectorQuery.filter(
      (doc) => doc.metadata.sessionId === sessionId
    )
  }

  if (fileId && Array.isArray(fileId)) {
    vectorQuery = vectorQuery.filter((doc) =>
      fileId.includes(doc.metadata.fileId || "")
    )
  }

  const vectorCount = await vectorQuery.count()
  const queryDimension = queryEmbedding.length

  if (
    config.useHNSW &&
    config.annBackend !== "bruteforce" &&
    config.hnswAutoRebuild &&
    vectorCount > 0
  ) {
    const stats = hnswIndexManager.getStats()
    const needsRebuild =
      !stats.isBuilding &&
      (stats.numElements === 0 || stats.dimension !== queryDimension)

    if (needsRebuild) {
      const now = Date.now()
      const sameDimension = lastHnswRebuildAttempt?.dimension === queryDimension
      const withinCooldown =
        lastHnswRebuildAttempt &&
        now - lastHnswRebuildAttempt.timestamp < HNSW_REBUILD_COOLDOWN_MS

      if (!sameDimension || !withinCooldown) {
        lastHnswRebuildAttempt = { dimension: queryDimension, timestamp: now }
        void hnswIndexManager
          .buildIndex(undefined, queryDimension)
          .catch((error) => {
            logger.warn("HNSW auto-rebuild failed", "searchSimilarVectors", {
              error
            })
          })
      }
    }
  }

  // Decide search strategy
  const useHNSW =
    (await hnswIndexManager.shouldUseHNSW(vectorCount)) &&
    hnswIndexManager.isCompatibleDimension(queryDimension)

  let results: SearchResult[]

  if (useHNSW) {
    // HNSW Search Path (High Quality)
    logger.verbose("HNSW Search started", "searchSimilarVectors", {
      vectorCount
    })
    try {
      results = await searchWithHNSW(
        queryEmbedding,
        limit,
        minSimilarity,
        vectorQuery
      )
      const duration = performance.now() - startTime
      logger.info("HNSW search completed", "searchSimilarVectors", {
        resultCount: results.length,
        duration: `${duration.toFixed(2)}ms`
      })
    } catch (error) {
      logger.warn(
        "HNSW Search failed, falling back to brute-force",
        "searchSimilarVectors",
        { error }
      )
      results = await searchBruteForce(
        queryEmbedding,
        limit,
        minSimilarity,
        vectorQuery
      )
    }
  } else {
    // Brute-force Search Path (Small datasets or HNSW disabled)
    logger.verbose("Brute-force search started", "searchSimilarVectors", {
      vectorCount,
      hnswStatus: config.useHNSW ? "not initialized" : "disabled"
    })
    results = await searchBruteForce(
      queryEmbedding,
      limit,
      minSimilarity,
      vectorQuery
    )
    const duration = performance.now() - startTime
    logger.info("Brute-force search completed", "searchSimilarVectors", {
      resultCount: results.length,
      duration: `${duration.toFixed(2)}ms`
    })
  }

  // Cache results
  await cleanSearchCache()
  searchCache.set(cacheKey, {
    results,
    timestamp: Date.now()
  })

  return results
}

import { classifyQuery, getWeightsForQueryType } from "./query-classifier"

/**
 * Hybrid search combining keyword and semantic search.
 * This is the primary retrieval mechanism for the RAG pipeline.
 * It uses Reciprocal Rank Fusion (implicit) by weighted scoring:
 * Final Score = (keywordWeight * normalizedBM25) + (semanticWeight * cosineSimilarity)
 */
export const searchHybrid = async (
  queryText: string,
  queryEmbedding: number[],
  options: {
    limit?: number
    minSimilarity?: number
    keywordWeight?: number
    semanticWeight?: number
    adaptiveWeights?: boolean
    type?: VectorDocument["metadata"]["type"]
    sessionId?: string
    fileId?: string | string[]
  } = {}
): Promise<SearchResult[]> => {
  const config = await getEmbeddingConfig()
  const {
    limit = 10,
    adaptiveWeights = config.useAdaptiveWeights ?? true,
    ...searchOptions
  } = options

  const startTime = performance.now()

  // Determine weights (adaptive or manual)
  let keywordWeight = options.keywordWeight ?? 0.7
  let semanticWeight = options.semanticWeight ?? 0.3

  if (adaptiveWeights && !options.keywordWeight && !options.semanticWeight) {
    // Use query classification for dynamic weights
    const queryType = classifyQuery(queryText)
    const weights = getWeightsForQueryType(queryType)
    keywordWeight = weights.keywordWeight
    semanticWeight = weights.semanticWeight

    logger.verbose(`Adaptive weights: ${queryType} query`, "searchHybrid", {
      keywordWeight,
      semanticWeight
    })
  }

  // 1. Keyword search (fast, exact)
  const keywordResults = keywordIndexManager.search(queryText, {
    limit: limit * 3, // Get more candidates for fusion
    fuzzy: 0.2,
    prefix: true,
    combineWith: "OR"
  })
  const filteredKeywordResults = keywordResults.filter((result) => {
    if (
      searchOptions.type &&
      result.document.metadata.type !== searchOptions.type
    ) {
      return false
    }
    if (
      searchOptions.sessionId &&
      result.document.metadata.sessionId !== searchOptions.sessionId
    ) {
      return false
    }
    if (searchOptions.fileId) {
      if (Array.isArray(searchOptions.fileId)) {
        return searchOptions.fileId.includes(
          result.document.metadata.fileId || ""
        )
      }
      return result.document.metadata.fileId === searchOptions.fileId
    }
    return true
  })

  // 2. Semantic search (conceptual)
  const semanticResults = await searchSimilarVectors(queryEmbedding, {
    ...searchOptions,
    limit: limit * 3
  })

  // 3. Fuse results with weighted scoring
  const scoreMap = new Map<number, number>()
  const docMap = new Map<number, VectorDocument>()

  // Normalize keyword scores (BM25 scores vary widely)
  const maxKeywordScore = Math.max(
    ...filteredKeywordResults.map((r) => r.score),
    1
  )

  // Add keyword scores
  for (const result of filteredKeywordResults) {
    const normalizedScore = result.score / maxKeywordScore
    scoreMap.set(result.id, keywordWeight * normalizedScore)
    docMap.set(result.id, result.document)
  }

  // Add semantic scores (already normalized 0-1)
  for (const result of semanticResults) {
    const id = result.document.id
    if (id === undefined) continue

    const existing = scoreMap.get(id) ?? 0
    scoreMap.set(id, existing + semanticWeight * result.similarity)
    if (!docMap.has(id)) {
      docMap.set(id, result.document)
    }
  }

  // Sort by combined score and limit
  const fusedResults = Array.from(scoreMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, similarity]) => {
      const document = docMap.get(id)
      if (!document) return null
      return {
        document,
        similarity
      }
    })
    .filter((r): r is SearchResult => r !== null)

  const duration = performance.now() - startTime
  logger.info("Hybrid search completed", "searchHybrid", {
    resultCount: fusedResults.length,
    keywordCount: filteredKeywordResults.length,
    semanticCount: semanticResults.length,
    duration: `${duration.toFixed(2)}ms`
  })

  return fusedResults
}

/**
 * Alias for backward compatibility with RAG retriever
 */
export const similaritySearchWithScore = searchSimilarVectors

/**
 * Retrieves context for RAG generation and formats it as a structured string.
 * Used for basic context injection where sophisticated pipeline features (reranking, diversity) aren't required.
 */
export const retrieveContext = async (
  query: string,
  fileIds?: string | string[],
  options: {
    limit?: number
    minSimilarity?: number
    type?: VectorDocument["metadata"]["type"]
  } = {}
): Promise<string> => {
  const embeddingResult = await generateEmbedding(query)
  if ("error" in embeddingResult) {
    logger.warn(
      "Failed to generate embedding for context retrieval",
      "retrieveContext",
      { error: embeddingResult.error }
    )
    return ""
  }

  const results = await searchSimilarVectors(embeddingResult.embedding, {
    fileId: fileIds,
    ...options
  })

  // Format results
  // Format: "Source: [title]\n[Content]\n\n"
  return results
    .map((r) => {
      const source =
        r.document.metadata.title ||
        r.document.metadata.source ||
        "Unknown Source"
      return `Source: ${source}\n${r.document.content}`
    })
    .join("\n\n")
}
