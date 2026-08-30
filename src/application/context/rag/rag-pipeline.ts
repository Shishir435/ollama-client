import { generateEmbedding } from "@/application/embeddings/embedding-service"
import { getEmbeddingConfig } from "@/lib/embeddings/config"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { rerankerService } from "@/lib/embeddings/reranker"
import { searchHybrid } from "@/lib/embeddings/search"
import type { VectorDocument } from "@/lib/embeddings/types"
import { logger } from "@/lib/logger"

/**
 * Enhanced RAG Pipeline with Multi-Stage Retrieval
 *
 * Pipeline stages:
 * 1. Hybrid Search (Recall) - Over-retrieve candidates
 * 2. Cosine Re-Scoring (Precision) - Re-score relevance by embedding cosine
 *    similarity (not a cross-encoder; MV3 CSP blocks one)
 * 3. MMR Diversity Filtering - Remove redundancy
 */

export interface RetrievalOptions {
  topK?: number
  mode?: "similarity" | "full"
  diversityEnabled?: boolean
  diversityLambda?: number
  recencyBoost?: number
  fileId?: string | string[]
  sessionId?: string
  type?: VectorDocument["metadata"]["type"]
  includeMemory?: boolean
  memoryTopK?: number
  minSimilarity?: number
  minRerankScore?: number
  /**
   * Cancellation for the whole retrieval.
   *
   * Retrieval is several awaits deep — a query embedding, one or two hybrid
   * searches, a re-scoring pass — and the embedding among them can be a slow
   * remote request that bills per call. Without a signal the turn that asked
   * for it can be stopped while all of that keeps running.
   */
  signal?: AbortSignal
}

export interface EnhancedSearchResult {
  document: VectorDocument
  score: number
  originalSimilarity?: number
  isMemory?: boolean
}

/**
 * Retrieve context with a multi-stage RAG pipeline.
 * Stages:
 * 1. Hybrid Search: Recall-optimized retrieval of candidates (5x topK).
 * 2. Cosine Re-Scoring: (Optional) Re-scores candidates by embedding cosine similarity.
 * 3. Temporal Boosting: Boosts scores for more recent documents.
 * 4. Feedback Blending: Adjusts scores based on historical user feedback.
 * 5. MMR Diversity Filtering: Selects final subset while minimizing structural redundancy.
 */
interface ResolvedRetrievalOptions {
  topK: number
  mode: "similarity" | "full"
  diversityEnabled: boolean
  diversityLambda: number
  fileId?: string | string[]
  sessionId?: string
  type?: VectorDocument["metadata"]["type"]
  includeMemory: boolean
  memoryTopK: number
  minSimilarity: number
  minRerankScore?: number
  signal?: AbortSignal
}

const resolveRetrievalOptions = (
  options: RetrievalOptions
): ResolvedRetrievalOptions => ({
  topK: options.topK ?? 5,
  mode: options.mode ?? "similarity",
  diversityEnabled: options.diversityEnabled ?? true,
  diversityLambda: options.diversityLambda ?? 0.7,
  fileId: options.fileId,
  sessionId: options.sessionId,
  type: options.type,
  includeMemory: options.includeMemory ?? false,
  memoryTopK: options.memoryTopK ?? 3,
  minSimilarity: options.minSimilarity ?? 0.3,
  minRerankScore: options.minRerankScore,
  signal: options.signal
})

const embeddingSearchOptions = (
  resolved: ResolvedRetrievalOptions,
  embedding: { embedding: number[]; model: string; providerId: string },
  overrides: {
    limit: number
    type: VectorDocument["metadata"]["type"]
    minSimilarity: number
  }
) => ({
  limit: overrides.limit,
  keywordWeight: 0.6,
  semanticWeight: 0.4,
  fileId: resolved.fileId,
  sessionId: resolved.sessionId,
  type: overrides.type,
  minSimilarity: overrides.minSimilarity,
  embeddingModel: embedding.model,
  embeddingProviderId: embedding.providerId,
  embeddingDimension: embedding.embedding.length
})

const retrieveFullMode = async (
  query: string,
  resolved: ResolvedRetrievalOptions
): Promise<EnhancedSearchResult[]> => {
  logger.info("Full mode selected, skipping re-ranking and MMR", "RAGPipeline")
  const embedding = await generateEmbedding(query, undefined, undefined, {
    ...(resolved.signal ? { signal: resolved.signal } : {})
  })
  if ("error" in embedding) {
    logger.error(
      "Failed to generate query embedding (full mode)",
      "RAGPipeline",
      {
        error: embedding.error
      }
    )
    return []
  }
  const results = await searchHybrid(
    query,
    embedding.embedding,
    embeddingSearchOptions(resolved, embedding, {
      limit: resolved.topK,
      type: resolved.type ?? "file",
      minSimilarity: resolved.minSimilarity
    })
  )
  logger.info(
    `Full mode complete: ${results.length} results (no re-ranking)`,
    "RAGPipeline"
  )
  return results.map((candidate) => ({
    document: candidate.document,
    score: candidate.similarity,
    originalSimilarity: candidate.similarity
  }))
}

const retrieveMemoryCandidates = async (
  query: string,
  embedding: { embedding: number[]; model: string; providerId: string },
  resolved: ResolvedRetrievalOptions
): Promise<EnhancedSearchResult[]> => {
  if (!resolved.includeMemory) return []
  logger.verbose("Stage 1.5: Memory search", "RAGPipeline", {
    memoryTopK: resolved.memoryTopK
  })
  const results = await searchHybrid(query, embedding.embedding, {
    limit: resolved.memoryTopK * 3,
    keywordWeight: 0.6,
    semanticWeight: 0.4,
    type: "chat",
    minSimilarity: resolved.minSimilarity * 0.5,
    embeddingModel: embedding.model,
    embeddingProviderId: embedding.providerId,
    embeddingDimension: embedding.embedding.length
  })
  const candidates = results.map((candidate) => ({
    document: candidate.document,
    score: candidate.similarity,
    originalSimilarity: candidate.similarity,
    isMemory: true
  }))
  logger.info(
    `Stage 1.5 complete: ${candidates.length} memory candidates`,
    "RAGPipeline"
  )
  return candidates
}

const thresholdCandidates = (
  candidates: Awaited<ReturnType<typeof searchHybrid>>,
  topK: number,
  minSimilarity: number
): EnhancedSearchResult[] => {
  const topScore = candidates[0]?.similarity ?? 0
  const adaptiveThreshold = Math.max(minSimilarity, topScore * 0.5)
  logger.info(
    "Re-ranking disabled, applying adaptive threshold",
    "RAGPipeline",
    {
      topScore: topScore.toFixed(3),
      adaptiveThreshold: adaptiveThreshold.toFixed(3)
    }
  )
  const results = candidates
    .filter((candidate) => candidate.similarity >= adaptiveThreshold)
    .slice(0, topK)
    .map((candidate) => ({
      document: candidate.document,
      score: candidate.similarity,
      originalSimilarity: candidate.similarity
    }))
  if (results.length > 0 || candidates.length === 0) return results
  const top = candidates[0]
  return [
    {
      document: top.document,
      score: top.similarity,
      originalSimilarity: top.similarity
    }
  ]
}

const rerankCandidates = async (
  candidates: Awaited<ReturnType<typeof searchHybrid>>,
  queryEmbedding: number[],
  topK: number,
  candidateK: number,
  minSimilarity: number,
  minRerankScore: number | undefined,
  embeddingConfig: Awaited<ReturnType<typeof getEmbeddingConfig>>
): Promise<EnhancedSearchResult[]> => {
  const useReranking = embeddingConfig.useReranking ?? true
  if (!useReranking) return thresholdCandidates(candidates, topK, minSimilarity)
  const backend = embeddingConfig.rerankerBackend ?? "none"
  logger.verbose(`Stage 2: Re-scoring with ${backend}`, "RAGPipeline")
  rerankerService.setBackend(backend)
  rerankerService.setEnabled(backend !== "none")
  const reranked = await rerankerService.rerank(
    queryEmbedding,
    candidates.map((candidate) => ({
      content: candidate.document.content,
      embedding: candidate.document.embedding,
      metadata: candidate.document.metadata
    })),
    Math.min(candidateK, topK * 2)
  )
  const topScore = reranked[0]?.score ?? 0
  const avgScore = reranked.length
    ? reranked.reduce((sum, result) => sum + result.score, 0) / reranked.length
    : 0
  logger.info(`Stage 2 complete: ${reranked.length} results`, "RAGPipeline", {
    topScore: topScore.toFixed(3),
    avgScore: avgScore.toFixed(3)
  })
  const threshold = minRerankScore ?? embeddingConfig.minRerankScore ?? 0.6
  const confident = reranked.filter((result) => result.score >= threshold)
  if (!confident.length) {
    logger.warn("No results passed re-ranking threshold", "RAGPipeline", {
      minScore: threshold,
      topScore
    })
    return []
  }
  logger.info(
    `Filtered to ${confident.length} confident results (score >= ${threshold})`,
    "RAGPipeline"
  )
  const candidateByContent = new Map(
    candidates.map((candidate) => [candidate.document.content, candidate])
  )
  return confident.map((result) => {
    const original = candidateByContent.get(result.content)
    return {
      document: {
        id: original?.document.id,
        content: result.content,
        embedding: original?.document.embedding || [],
        metadata: result.metadata || {}
      } as VectorDocument,
      score: result.score,
      originalSimilarity: original?.similarity
    }
  })
}

const blendFeedback = async (
  query: string,
  results: EnhancedSearchResult[],
  embeddingConfig: Awaited<ReturnType<typeof getEmbeddingConfig>>
): Promise<void> => {
  if (!embeddingConfig.feedbackEnabled) return
  logger.verbose("Stage 2.5: Blending feedback scores", "RAGPipeline")
  for (const result of results) {
    if (result.isMemory) continue
    const chunkId = result.document.id?.toString()
    if (!chunkId) continue
    const feedbackScore = await feedbackService.getFeedbackScore(chunkId, query)
    if (feedbackScore === null) continue
    const blendWeight = embeddingConfig.feedbackBlendWeight || 0.2
    const originalScore = result.score
    result.score =
      (1 - blendWeight) * originalScore + blendWeight * feedbackScore
    logger.verbose(
      `Blended score for chunk ${chunkId}: ${originalScore.toFixed(3)} → ${result.score.toFixed(3)}`,
      "RAGPipeline"
    )
  }
  results.sort((a, b) => b.score - a.score)
}

const selectDiverseResults = (
  results: EnhancedSearchResult[],
  resolved: ResolvedRetrievalOptions
): EnhancedSearchResult[] => {
  const fileResults = results.filter((result) => !result.isMemory)
  const memoryResults = results.filter((result) => result.isMemory)
  if (!resolved.diversityEnabled) {
    return [
      ...fileResults.slice(0, resolved.topK),
      ...memoryResults.slice(0, 1)
    ]
  }
  logger.verbose("Stage 3: MMR diversity filtering", "RAGPipeline", {
    lambda: resolved.diversityLambda
  })
  const diversified = [
    ...applyMMR(fileResults, resolved.topK, resolved.diversityLambda),
    ...memoryResults.slice(0, 1)
  ]
  const fileCount = diversified.filter((result) => !result.isMemory).length
  logger.info(
    `Stage 3 complete: ${diversified.length} final results (${fileCount} files, ${diversified.length - fileCount} memory)`,
    "RAGPipeline"
  )
  return diversified
}

export async function retrieveContextEnhanced(
  query: string,
  options: RetrievalOptions = {}
): Promise<EnhancedSearchResult[]> {
  const resolved = resolveRetrievalOptions(options)
  if (resolved.mode === "full") return retrieveFullMode(query, resolved)
  resolved.signal?.throwIfAborted()
  const embedding = await generateEmbedding(query, undefined, undefined, {
    ...(resolved.signal ? { signal: resolved.signal } : {})
  })
  if ("error" in embedding) {
    logger.error("Failed to generate query embedding", "RAGPipeline", {
      error: embedding.error
    })
    return []
  }
  const candidateK = resolved.topK * 5
  logger.verbose("Stage 1: Hybrid search", "RAGPipeline", {
    candidateK,
    topK: resolved.topK,
    includeMemory: resolved.includeMemory
  })
  resolved.signal?.throwIfAborted()
  const candidates = await searchHybrid(
    query,
    embedding.embedding,
    embeddingSearchOptions(resolved, embedding, {
      limit: candidateK,
      type: resolved.type ?? "file",
      minSimilarity: resolved.minSimilarity * 0.7
    })
  )
  const memoryCandidates = await retrieveMemoryCandidates(
    query,
    embedding,
    resolved
  )
  if (!candidates.length && !memoryCandidates.length) {
    logger.info("No candidates found in hybrid search", "RAGPipeline")
    return []
  }
  logger.info(
    `Stage 1 complete: ${candidates.length} candidates`,
    "RAGPipeline"
  )
  const embeddingConfig = await getEmbeddingConfig()
  let ranked = await rerankCandidates(
    candidates,
    embedding.embedding,
    resolved.topK,
    candidateK,
    resolved.minSimilarity,
    resolved.minRerankScore,
    embeddingConfig
  )
  if (!ranked.length && (embeddingConfig.useReranking ?? true)) return []
  if (memoryCandidates.length) {
    const boostedMemory = memoryCandidates.map((memory) => ({
      ...memory,
      score: memory.score * 0.9
    }))
    ranked = [...ranked, ...boostedMemory]
    logger.info(
      `Added ${boostedMemory.length} memory results to pool`,
      "RAGPipeline"
    )
  }
  await blendFeedback(query, ranked, embeddingConfig)
  return selectDiverseResults(ranked, resolved)
}

/**
 * Maximal Marginal Relevance (MMR) for diversity filtering.
 * Balances relevance with diversity to avoid redundant results in the context window.
 * The algorithm selects a document i that maximizes:
 * MMR(i) = λ * Similarity(i, Query) - (1-λ) * max_j[Similarity(i, j)]
 * where j are documents already selected.
 */
function applyMMR(
  results: EnhancedSearchResult[],
  k: number,
  lambda: number = 0.7
): EnhancedSearchResult[] {
  if (results.length <= k) return results

  const selected: EnhancedSearchResult[] = [results[0]] // Most relevant
  const remaining = results.slice(1)

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0
    let bestScore = -Infinity

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]

      // Relevance component (from re-ranker)
      const relevance = candidate.score

      // Diversity component: semantic similarity to already selected
      const similarities = selected.map((s) =>
        semanticSimilarity(candidate.document, s.document)
      )
      const maxSim = Math.max(...similarities)

      // MMR formula: λ * relevance - (1-λ) * max_similarity
      const mmrScore = lambda * relevance - (1 - lambda) * maxSim

      if (mmrScore > bestScore) {
        bestScore = mmrScore
        bestIdx = i
      }
    }

    selected.push(remaining[bestIdx])
    remaining.splice(bestIdx, 1)
  }

  return selected
}

/**
 * Semantic similarity using embeddings for better diversity detection
 * Uses cosine similarity between document embeddings
 */
function semanticSimilarity(
  doc1: VectorDocument,
  doc2: VectorDocument
): number {
  // Use pre-computed normalized embeddings if available for speed
  const emb1 = doc1.normalizedEmbedding || doc1.embedding
  const emb2 = doc2.normalizedEmbedding || doc2.embedding

  if (!emb1 || !emb2 || emb1.length !== emb2.length) {
    // Fallback to text-based Jaccard similarity if embeddings unavailable
    const words1 = new Set(doc1.content.toLowerCase().split(/\s+/))
    const words2 = new Set(doc2.content.toLowerCase().split(/\s+/))
    const intersection = new Set([...words1].filter((w) => words2.has(w)))
    const union = new Set([...words1, ...words2])
    return intersection.size / Math.max(union.size, 1)
  }

  // Cosine similarity (dot product for normalized vectors)
  let dotProduct = 0
  for (let i = 0; i < emb1.length; i++) {
    dotProduct += emb1[i] * emb2[i]
  }

  return Math.max(0, Math.min(1, dotProduct)) // Clamp to [0, 1]
}

import { estimateTokens } from "@/lib/embeddings/chunker"

/**
 * Format enhanced search results into standard VectorDocument objects and formatted prompt strings with token limits.
 * Estimates token usage for each chunk to fit the target context window perfectly.
 */
export function formatEnhancedResults(
  results: EnhancedSearchResult[],
  maxTokens?: number
): {
  documents: VectorDocument[]
  formattedContext: string
  sources: Array<{
    id: string | number
    title: string
    content: string
    score: number
    source?: string
    chunkIndex?: number
    page?: number
    fileId?: string
    type?: string
  }>
} {
  let currentTokens = 0
  const includedResults: EnhancedSearchResult[] = []

  // Filter results by token limit
  for (const result of results) {
    // metadata overhead estimate (approx 20 tokens)
    const content = result.document.content
    const tokens = estimateTokens(content) + 20

    if (maxTokens && currentTokens + tokens > maxTokens) {
      if (includedResults.length === 0) {
        // Always include at least one result even if it exceeds the budget.
        // A single over-budget chunk is better than returning zero context.
        includedResults.push(result)
      }
      break
    }

    currentTokens += tokens
    includedResults.push(result)
  }

  const documents = includedResults.map((r) => r.document)

  const formattedContext = includedResults
    .map((r, i) => {
      const isMemory = r.isMemory
      const source = isMemory
        ? `Previous conversation${r.document.metadata.sessionId ? ` (session)` : ""}`
        : r.document.metadata.title || r.document.metadata.source || "Unknown"
      const page = r.document.metadata.page
      const chunkIndex = r.document.metadata.chunkIndex
      const totalChunks = r.document.metadata.totalChunks
      const chunkLabel =
        chunkIndex !== undefined
          ? `${chunkIndex + 1}${totalChunks ? `/${totalChunks}` : ""}`
          : undefined

      const clampedScore = Math.min(1, r.score)
      const attrs = [
        `id="${i + 1}"`,
        `source="${escapeAttribute(source)}"`,
        page ? `page="${page}"` : undefined,
        chunkLabel ? `chunk="${chunkLabel}"` : undefined,
        r.score ? `score="${clampedScore.toFixed(3)}"` : undefined
      ]
        .filter(Boolean)
        .join(" ")

      if (isMemory) {
        return `<memory ${attrs}>\n${r.document.content}\n</memory>`
      }

      return `<doc ${attrs}>\n${r.document.content}\n</doc>`
    })
    .join("\n\n")

  const sources = includedResults.map((r) => ({
    id: r.document.id || 0,
    title: r.isMemory
      ? "Previous Conversation"
      : r.document.metadata.title || r.document.metadata.source || "Unknown",
    content: r.document.content,
    score: Math.min(1, r.score),
    source: r.document.metadata.source,
    chunkIndex: r.document.metadata.chunkIndex,
    page: r.document.metadata.page,
    fileId: r.document.metadata.fileId,
    type: r.isMemory ? "memory" : r.document.metadata.type,
    isMemory: r.isMemory
  }))

  return {
    documents,
    formattedContext,
    sources
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "'").replace(/\s+/g, " ").trim()
}
