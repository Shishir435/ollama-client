import type Dexie from "dexie"
import { EmbeddingService } from "@/application/embeddings/embedding-service"
import {
  DEFAULT_EMBEDDING_MODEL,
  normalizeEmbeddingModelName
} from "@/lib/constants"
import { hnswIndexManager } from "@/lib/embeddings/hnsw-index"
import {
  keywordIndexManager,
  type KeywordIndexDocument
} from "@/lib/embeddings/keyword-index"
import { logger } from "@/lib/logger"
import {
  cleanSearchCache,
  getCacheConfig,
  hashSearchQuery,
  searchCache
} from "./cache"
import { getEmbeddingConfig } from "./config"
import { vectorDb } from "./db"
import {
  cosineSimilarityOptimized,
  insertTopKBySimilarity,
  normalizeVector
} from "./math"
import { readNativeIndexState } from "./native/state"
import type { SearchResult, VectorDocument } from "./types"
import { matchesVectorType } from "./types"

let nativeGeneration = 0
let generationRefresh: Promise<void> | undefined
const refreshIndexGeneration = async (): Promise<void> => {
  for (;;) {
    if (generationRefresh) {
      await generationRefresh
      continue
    }
    const { generation } = await readNativeIndexState()
    if (generationRefresh) continue
    if (nativeGeneration === generation) return
    const work = (async () => {
      searchCache.clear()
      keywordIndexManager.clear()
      await hnswIndexManager.clearIndex()
      await keywordIndexManager.buildFromDocuments(
        await vectorDb.vectors.toArray()
      )
      nativeGeneration = generation
    })()
    generationRefresh = work
    try {
      await work
    } finally {
      if (generationRefresh === work) generationRefresh = undefined
    }
  }
}

const HNSW_REBUILD_COOLDOWN_MS = 30000
let lastHnswRebuildAttempt: { dimension: number; timestamp: number } | null =
  null

/** Cursor iteration bounds retained rows to top-K; scoped indexes select the corpus first. */
async function searchBruteForce(
  queryEmbedding: number[],
  limit: number,
  minSimilarity: number,
  documents: Dexie.Collection<VectorDocument, number>
): Promise<SearchResult[]> {
  const { normalized: queryNormalized, norm: queryNorm } =
    normalizeVector(queryEmbedding)
  const results: SearchResult[] = []
  await documents.each((doc) => {
    if (doc.embedding.length !== queryNormalized.length) return
    const similarity = cosineSimilarityOptimized(
      queryNormalized,
      queryNorm,
      doc.embedding,
      doc.norm,
      doc.normalizedEmbedding
    )
    if (similarity >= minSimilarity)
      insertTopKBySimilarity(results, { document: doc, similarity }, limit)
  })
  return results
}

/**
 * Searches for similar vectors using HNSW or brute-force cosine similarity.
 * Automatically decides the strategy based on data size and backend availability.
 * Incorporates results from the HNSW graph if populated, otherwise scans the DB sequentially.
 * Results are cached to minimize redundant embedding and DB lookups.
 */
type VectorSearchOptions = {
  limit?: number
  minSimilarity?: number
  type?: VectorDocument["metadata"]["type"]
  sessionId?: string
  fileId?: string | string[]
  embeddingModel?: string
  embeddingProviderId?: string
  embeddingDimension?: number
}

const baseVectorQuery = (
  options: VectorSearchOptions
): Dexie.Collection<VectorDocument, number> => {
  const { sessionId, fileId, type } = options
  if (Array.isArray(fileId))
    return vectorDb.vectors.where("metadata.fileId").anyOf([...new Set(fileId)])
  if (fileId) return vectorDb.vectors.where("metadata.fileId").equals(fileId)
  if (sessionId)
    return vectorDb.vectors.where("metadata.sessionId").equals(sessionId)
  if (type === "file")
    return vectorDb.vectors.where("metadata.type").noneOf(["chat", "webpage"])
  if (type) return vectorDb.vectors.where("metadata.type").equals(type)
  return vectorDb.vectors.toCollection()
}

const applyMetadataFilters = (
  query: Dexie.Collection<VectorDocument, number>,
  options: VectorSearchOptions
): Dexie.Collection<VectorDocument, number> => {
  const { sessionId, fileId, type } = options
  let filtered = query
  if (type) {
    filtered = filtered.filter((doc) =>
      matchesVectorType(doc.metadata.type, type)
    )
  }
  if (sessionId) {
    filtered = filtered.filter((doc) => doc.metadata.sessionId === sessionId)
  }
  if (Array.isArray(fileId)) {
    filtered = filtered.filter((doc) =>
      fileId.includes(doc.metadata.fileId || "")
    )
  } else if (fileId) {
    filtered = filtered.filter((doc) => doc.metadata.fileId === fileId)
  }
  return filtered
}

const applyEmbeddingPartition = (
  query: Dexie.Collection<VectorDocument, number>,
  queryDimension: number,
  normalizedEmbeddingModel: string,
  embeddingProviderId: string | null
): Dexie.Collection<VectorDocument, number> =>
  query.filter((doc) => {
    const docDimension = doc.metadata.embeddingDim ?? doc.embedding.length
    if (docDimension !== queryDimension) return false
    const docModel = normalizeEmbeddingModelName(
      doc.metadata.embeddingModel || DEFAULT_EMBEDDING_MODEL
    )
    if (docModel !== normalizedEmbeddingModel) return false
    const docProviderId = doc.metadata.embeddingProviderId
    if (embeddingProviderId) {
      return !docProviderId || docProviderId === embeddingProviderId
    }
    return !docProviderId
  })

const maybeScheduleHnswRebuild = (
  config: Awaited<ReturnType<typeof getEmbeddingConfig>>,
  allowHNSW: boolean,
  vectorCount: number,
  queryDimension: number
): void => {
  if (
    !allowHNSW ||
    !config.useHNSW ||
    config.annBackend === "bruteforce" ||
    !config.hnswAutoRebuild ||
    vectorCount <= 0
  )
    return
  const stats = hnswIndexManager.getStats()
  if (
    stats.isBuilding ||
    (stats.numElements > 0 && stats.dimension === queryDimension)
  )
    return
  const now = Date.now()
  const sameDimension = lastHnswRebuildAttempt?.dimension === queryDimension
  const withinCooldown = Boolean(
    lastHnswRebuildAttempt &&
    now - lastHnswRebuildAttempt.timestamp < HNSW_REBUILD_COOLDOWN_MS
  )
  if (sameDimension && withinCooldown) return
  lastHnswRebuildAttempt = { dimension: queryDimension, timestamp: now }
  void hnswIndexManager.buildIndex(undefined, queryDimension).catch((error) => {
    logger.warn("HNSW auto-rebuild failed", "searchSimilarVectors", { error })
  })
}

export const searchSimilarVectors = async (
  queryEmbedding: number[],
  options: VectorSearchOptions = {}
): Promise<SearchResult[]> => {
  await refreshIndexGeneration()
  const config = await getEmbeddingConfig()
  const limit = options.limit ?? config.defaultSearchLimit
  const minSimilarity = options.minSimilarity ?? config.defaultMinSimilarity
  const cacheKey = hashSearchQuery(queryEmbedding, options)
  const cached = searchCache.get(cacheKey)
  const { ttl } = await getCacheConfig()
  if (cached && Date.now() - cached.timestamp < ttl) {
    const current = await vectorDb.vectors.bulkGet(
      cached.results.map((result) => result.document.id!)
    )
    if (
      current.some(
        (doc, index) =>
          !doc ||
          doc.metadata.messageRevision !==
            cached.results[index].document.metadata.messageRevision
      )
    ) {
      searchCache.delete(cacheKey)
    } else {
      logger.info("Returning cached search results", "searchSimilarVectors")
      return cached.results
    }
  }

  const startTime = performance.now()
  const queryDimension = options.embeddingDimension ?? queryEmbedding.length
  const normalizedEmbeddingModel = normalizeEmbeddingModelName(
    options.embeddingModel || DEFAULT_EMBEDDING_MODEL
  )
  const embeddingProviderId = options.embeddingProviderId || null
  const allowHNSW = !options.embeddingModel && !embeddingProviderId
  let vectorQuery = applyMetadataFilters(baseVectorQuery(options), options)
  vectorQuery = applyEmbeddingPartition(
    vectorQuery,
    queryDimension,
    normalizedEmbeddingModel,
    embeddingProviderId
  )
  const hnswGeneration = hnswIndexManager.getInvalidationGeneration?.() ?? 0
  // Scoped searches must rank inside their eligible corpus. HNSW's API has
  // no pre-ranking predicate, so use the indexed exact cursor for those.
  const scoped =
    !!options.type || !!options.sessionId || options.fileId !== undefined
  // Only unscoped searches use the count (HNSW choice and rebuild), so a
  // scoped one skips the index walk.
  const vectorCount = scoped ? 0 : await baseVectorQuery(options).count()
  maybeScheduleHnswRebuild(
    config,
    allowHNSW && !scoped,
    vectorCount,
    queryDimension
  )
  const useHNSW =
    allowHNSW &&
    !scoped &&
    (await hnswIndexManager.shouldUseHNSW(vectorCount)) &&
    hnswIndexManager.isCompatibleDimension(queryDimension)
  let results: SearchResult[] | undefined
  if (useHNSW) {
    try {
      // Search the graph before reading content. Hydrate only its bounded
      // candidate IDs; any stale or foreign-partition candidate forces an
      // exact filtered scan, rather than allowing it to consume top-K slots.
      const candidates = await hnswIndexManager.search(
        queryEmbedding,
        limit * 2
      )
      const ids = candidates.map((candidate) => candidate.id)
      const eligible = await applyEmbeddingPartition(
        vectorDb.vectors.where(":id").anyOf(ids),
        queryDimension,
        normalizedEmbeddingModel,
        embeddingProviderId
      ).toArray()
      if (
        eligible.length === candidates.length &&
        candidates.length >= Math.min(limit, vectorCount)
      ) {
        const byId = new Map(eligible.map((doc) => [doc.id, doc]))
        results = candidates
          .flatMap(({ id, distance }) => {
            const document = byId.get(id)
            return document && distance >= minSimilarity
              ? [{ document, similarity: distance }]
              : []
          })
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit)
      }
    } catch (error) {
      logger.warn(
        "HNSW search unavailable; using exact filtered search",
        "searchSimilarVectors",
        { error }
      )
    }
  }
  if (
    !results ||
    hnswGeneration !==
      (hnswIndexManager.getInvalidationGeneration?.() ?? hnswGeneration)
  ) {
    results = await searchBruteForce(
      queryEmbedding,
      limit,
      minSimilarity,
      vectorQuery
    )
  }
  logger.info("Vector search completed", "searchSimilarVectors", {
    resultCount: results.length,
    duration: `${(performance.now() - startTime).toFixed(2)}ms`
  })
  await cleanSearchCache()
  searchCache.set(cacheKey, { results, timestamp: Date.now() })
  return results
}

/**
 * Hybrid search combining keyword and semantic search.
 * This is the primary retrieval mechanism for the RAG pipeline.
 * It uses Reciprocal Rank Fusion (implicit) by weighted scoring:
 * Final Score = (keywordWeight * normalizedBM25) + (semanticWeight * cosineSimilarity)
 */
/**
 * Reads stored rows for keyword candidates that survived filtering.
 *
 * Keyed by id via `bulkGet`, so the cost is proportional to the candidate
 * count rather than the corpus. Missing ids are skipped: a vector deleted
 * between indexing and this read is simply no longer a candidate.
 */
const hydrateKeywordCandidates = async (
  ids: number[]
): Promise<Map<number, VectorDocument>> => {
  const hydrated = new Map<number, VectorDocument>()
  if (ids.length === 0) return hydrated

  const rows = await vectorDb.vectors.bulkGet(ids)
  for (const row of rows) {
    if (row?.id === undefined) continue
    hydrated.set(row.id, row)
  }
  return hydrated
}

export const searchHybrid = async (
  queryText: string,
  queryEmbedding: number[],
  options: {
    limit?: number
    minSimilarity?: number
    keywordWeight?: number
    semanticWeight?: number
    type?: VectorDocument["metadata"]["type"]
    sessionId?: string
    fileId?: string | string[]
    embeddingModel?: string
    embeddingProviderId?: string
    embeddingDimension?: number
  } = {}
): Promise<SearchResult[]> => {
  await refreshIndexGeneration()
  const { limit = 10, ...searchOptions } = options

  const startTime = performance.now()

  const keywordWeight = options.keywordWeight ?? 0.7
  const semanticWeight = options.semanticWeight ?? 0.3

  const keywordCandidateMatches = (document: KeywordIndexDocument): boolean => {
    const queryDimension =
      searchOptions.embeddingDimension ?? queryEmbedding.length
    const documentDimension =
      document.metadata.embeddingDim ?? document.embeddingDim
    if (documentDimension !== queryDimension) return false
    const requestedModel = normalizeEmbeddingModelName(
      searchOptions.embeddingModel || DEFAULT_EMBEDDING_MODEL
    )
    const documentModel = normalizeEmbeddingModelName(
      document.metadata.embeddingModel || DEFAULT_EMBEDDING_MODEL
    )
    if (documentModel !== requestedModel) return false
    const requestedProvider = searchOptions.embeddingProviderId
    const documentProvider = document.metadata.embeddingProviderId
    if (
      requestedProvider &&
      documentProvider &&
      requestedProvider !== documentProvider
    )
      return false
    if (!requestedProvider && documentProvider) return false
    if (
      searchOptions.type &&
      !matchesVectorType(document.metadata.type, searchOptions.type)
    )
      return false
    if (
      searchOptions.sessionId &&
      document.metadata.sessionId !== searchOptions.sessionId
    )
      return false
    if (Array.isArray(searchOptions.fileId)) {
      return searchOptions.fileId.includes(document.metadata.fileId || "")
    }
    return (
      !searchOptions.fileId || document.metadata.fileId === searchOptions.fileId
    )
  }

  // Filter before MiniSearch ranks and limits so out-of-scope hits cannot hide
  // relevant candidates from the requested corpus.
  const keywordResults = keywordIndexManager.search(queryText, {
    limit: limit * 3,
    fuzzy: 0.2,
    prefix: true,
    combineWith: "OR",
    filter: keywordCandidateMatches
  })
  const filteredKeywordResults = keywordResults.filter((result) =>
    keywordCandidateMatches(result.document)
  )

  // 2. Semantic search (conceptual)
  const semanticResults = await searchSimilarVectors(queryEmbedding, {
    ...searchOptions,
    limit: limit * 3
  })

  // 3. Weighted Reciprocal Rank Fusion (RRF)
  // Rank-based fusion is immune to score-scale mismatches between BM25 and cosine.
  // keywordWeight / semanticWeight control relative list importance; k=60 is standard.
  const RRF_K = 60
  const scoreMap = new Map<number, number>()
  const docMap = new Map<number, VectorDocument>()

  // The keyword index retains a projection with no vectors, so the surviving
  // candidates are read back before fusion — reranking scores on
  // `document.embedding`, and a document without one is silently given a
  // neutral score rather than failing. Bounded by `limit * 3`, so this is a
  // keyed lookup, not a table scan.
  const hydratedKeywordDocs = await hydrateKeywordCandidates(
    filteredKeywordResults.map((result) => result.id)
  )

  for (let rank = 0; rank < filteredKeywordResults.length; rank++) {
    const result = filteredKeywordResults[rank]
    const hydrated = hydratedKeywordDocs.get(result.id)
    // A row deleted between indexing and this read has nothing to score.
    if (!hydrated) continue
    scoreMap.set(
      result.id,
      (scoreMap.get(result.id) ?? 0) + keywordWeight / (RRF_K + rank + 1)
    )
    docMap.set(result.id, hydrated)
  }

  for (let rank = 0; rank < semanticResults.length; rank++) {
    const result = semanticResults[rank]
    const id = result.document.id
    if (id === undefined) continue
    scoreMap.set(
      id,
      (scoreMap.get(id) ?? 0) + semanticWeight / (RRF_K + rank + 1)
    )
    if (!docMap.has(id)) docMap.set(id, result.document)
  }

  // Normalize to [0, 1] relative to batch best so downstream thresholds still apply
  const maxRrfScore = Math.max(...scoreMap.values(), Number.EPSILON)

  const fusedResults = Array.from(scoreMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, rrfScore]) => {
      const document = docMap.get(id)
      if (!document) return null
      return { document, similarity: rrfScore / maxRrfScore }
    })
    .filter((r): r is SearchResult => r !== null)

  // 4. Title boost: documents whose title contains query terms rank up to 15% higher
  const queryTerms = queryText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
  if (queryTerms.length > 0) {
    for (const result of fusedResults) {
      const title = (
        result.document.metadata.title ||
        result.document.metadata.source ||
        ""
      ).toLowerCase()
      const matches = queryTerms.filter((t) => title.includes(t)).length
      if (matches > 0) {
        result.similarity = Math.min(
          1,
          result.similarity * (1 + Math.min(matches * 0.05, 0.15))
        )
      }
    }
    fusedResults.sort((a, b) => b.similarity - a.similarity)
  }

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
  const embeddingResult = await EmbeddingService.generate(query)
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
    ...options,
    embeddingModel: embeddingResult.model,
    embeddingProviderId: embeddingResult.providerId,
    embeddingDimension: embeddingResult.embedding.length
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
