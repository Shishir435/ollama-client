import { getEmbeddingConfig } from "@/lib/embeddings/config"
import { generateEmbedding } from "@/lib/embeddings/embedding-client"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { applyRecencyBoost } from "@/lib/embeddings/recency-boost"
import { rerankerService } from "@/lib/embeddings/reranker"
import { searchHybrid } from "@/lib/embeddings/search"
import type { VectorDocument } from "@/lib/embeddings/types"
import { logger } from "@/lib/logger"

/**
 * Enhanced RAG Pipeline with Multi-Stage Retrieval
 *
 * Pipeline stages:
 * 1. Hybrid Search (Recall) - Over-retrieve candidates
 * 2. Cross-Encoder Re-Ranking (Precision) - Score relevance
 * 3. MMR Diversity Filtering - Remove redundancy
 */

export interface RetrievalOptions {
  topK?: number
  mode?: "similarity" | "full"
  diversityEnabled?: boolean
  diversityLambda?: number
  recencyBoost?: number
  fileId?: string | string[]
  minSimilarity?: number
  minRerankScore?: number
}

export interface EnhancedSearchResult {
  document: VectorDocument
  score: number
  originalSimilarity?: number
}

/**
 * Retrieve context with multi-stage pipeline
 */
export async function retrieveContextEnhanced(
  query: string,
  options: RetrievalOptions = {}
): Promise<EnhancedSearchResult[]> {
  const {
    topK = 5,
    mode = "similarity",
    diversityEnabled = true,
    diversityLambda = 0.7,
    fileId,
    minSimilarity = 0.3,
    minRerankScore
  } = options

  // Full mode: return all documents (no re-ranking needed)
  if (mode === "full") {
    logger.info("Full mode selected, skipping re-ranking", "RAGPipeline")
    return []
  }

  // Generate query embedding
  const embeddingResult = await generateEmbedding(query)
  if ("error" in embeddingResult) {
    logger.error("Failed to generate query embedding", "RAGPipeline", {
      error: embeddingResult.error
    })
    return []
  }

  // ===== STAGE 1: Hybrid Search (Recall-Optimized) =====
  const candidateK = topK * 5 // Over-retrieve for re-ranking

  logger.verbose("Stage 1: Hybrid search", "RAGPipeline", {
    candidateK,
    topK
  })

  const candidates = await searchHybrid(query, embeddingResult.embedding, {
    limit: candidateK,
    keywordWeight: 0.6,
    semanticWeight: 0.4,
    fileId,
    type: "file",
    minSimilarity: minSimilarity * 0.7 // Lower threshold for recall
  })

  if (candidates.length === 0) {
    logger.info("No candidates found in hybrid search", "RAGPipeline")
    return []
  }

  logger.info(
    `Stage 1 complete: ${candidates.length} candidates`,
    "RAGPipeline"
  )

  // ===== STAGE 2: Cross-Encoder Re-Ranking (Precision-Optimized) =====
  logger.verbose("Stage 2: Re-ranking with transformers.js", "RAGPipeline")

  const reranked = await rerankerService.rerank(
    query,
    candidates.map((c) => ({
      content: c.document.content,
      metadata: c.document.metadata
    })),
    Math.min(candidateK, topK * 2) // Get 2x topK for diversity filtering
  )

  logger.info(`Stage 2 complete: ${reranked.length} results`, "RAGPipeline", {
    topScore: reranked[0]?.score.toFixed(3),
    avgScore: (
      reranked.reduce((sum, r) => sum + r.score, 0) / reranked.length
    ).toFixed(3)
  })

  const configForThreshold = await getEmbeddingConfig()
  const MIN_RERANK_SCORE =
    minRerankScore ?? configForThreshold.minRerankScore ?? 0.6
  const confidentResults = reranked.filter((r) => r.score >= MIN_RERANK_SCORE)

  if (confidentResults.length === 0) {
    logger.warn("No results passed re-ranking threshold", "RAGPipeline", {
      minScore: MIN_RERANK_SCORE,
      topScore: reranked[0]?.score
    })
    return [] // Return empty if no confident matches
  }

  logger.info(
    `Filtered to ${confidentResults.length} confident results (score >= ${MIN_RERANK_SCORE})`,
    "RAGPipeline"
  )

  // Convert to EnhancedSearchResult format
  const rerankedResults: EnhancedSearchResult[] = confidentResults.map(
    (r, _idx) => {
      const originalCandidate = candidates.find(
        (c) => c.document.content === r.content
      )
      return {
        document: {
          id: originalCandidate?.document.id,
          content: r.content,
          embedding: originalCandidate?.document.embedding || [],
          metadata: r.metadata || {}
        } as VectorDocument,
        score: r.score,
        originalSimilarity: originalCandidate?.similarity
      }
    }
  )

  // ===== STAGE 2.5: Feedback Score Blending =====
  // Blend user feedback scores with model scores
  const embeddingConfig = await getEmbeddingConfig()

  if (embeddingConfig.feedbackEnabled) {
    logger.verbose("Stage 2.5: Blending feedback scores", "RAGPipeline")

    for (const result of rerankedResults) {
      // Get feedback score for this chunk + query combination
      const chunkId = result.document.id?.toString()
      if (chunkId) {
        const feedbackScore = await feedbackService.getFeedbackScore(
          chunkId,
          query
        )

        if (feedbackScore !== null) {
          // Blend scores: (1 - weight) * modelScore + weight * feedbackScore
          const blendWeight = embeddingConfig.feedbackBlendWeight || 0.2
          const originalScore = result.score
          result.score =
            (1 - blendWeight) * originalScore + blendWeight * feedbackScore

          logger.verbose(
            `Blended score for chunk ${chunkId}: ${originalScore.toFixed(3)} → ${result.score.toFixed(3)}`,
            "RAGPipeline"
          )
        }
      }
    }

    // Re-sort after blending
    rerankedResults.sort((a, b) => b.score - a.score)
  }

  // ===== STAGE 2.6: Temporal Relevance Boosting =====
  const embeddingConfig2 = await getEmbeddingConfig()

  if (embeddingConfig2.useTemporalBoosting) {
    logger.verbose(
      "Stage 2.6: Applying temporal relevance boost",
      "RAGPipeline"
    )

    applyRecencyBoost(
      rerankedResults,
      embeddingConfig2.temporalBoostWeight || 0.3,
      embeddingConfig2.temporalHalfLife || 90
    )

    // Re-sort after boosting
    rerankedResults.sort((a, b) => b.score - a.score)
  }

  // ===== STAGE 3: MMR Diversity Filtering =====
  if (!diversityEnabled) {
    return rerankedResults.slice(0, topK)
  }

  logger.verbose("Stage 3: MMR diversity filtering", "RAGPipeline", {
    lambda: diversityLambda
  })

  const diversified = applyMMR(rerankedResults, topK, diversityLambda)

  logger.info(
    `Stage 3 complete: ${diversified.length} final results`,
    "RAGPipeline"
  )

  return diversified
}

/**
 * Maximal Marginal Relevance (MMR) for diversity
 * Balances relevance with diversity to avoid redundant results
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
 * Format enhanced results back to standard format with token limits
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
        // Always include at least one result if possible, or truncate it?
        // For now, if even the first one is too big, we might skip or let it pass
        // (but usually chunks are small enough).
        // Let's include it but warn/truncate if we were doing fancy truncation.
        // Here we just stop adding more.
      }
      break
    }

    currentTokens += tokens
    includedResults.push(result)
  }

  const documents = includedResults.map((r) => r.document)

  const formattedContext = includedResults
    .map((r, i) => {
      const source =
        r.document.metadata.title || r.document.metadata.source || "Unknown"
      const page = r.document.metadata.page
      const chunkIndex = r.document.metadata.chunkIndex
      const totalChunks = r.document.metadata.totalChunks
      const chunkLabel =
        chunkIndex !== undefined
          ? `${chunkIndex + 1}${totalChunks ? `/${totalChunks}` : ""}`
          : undefined

      const attrs = [
        `id="${i + 1}"`,
        `source="${escapeAttribute(source)}"`,
        page ? `page="${page}"` : undefined,
        chunkLabel ? `chunk="${chunkLabel}"` : undefined,
        r.score ? `score="${r.score.toFixed(3)}"` : undefined
      ]
        .filter(Boolean)
        .join(" ")

      return `<doc ${attrs}>\n${r.document.content}\n</doc>`
    })
    .join("\n\n")

  const sources = includedResults.map((r) => ({
    id: r.document.id || 0,
    title: r.document.metadata.title || r.document.metadata.source || "Unknown",
    content: r.document.content,
    score: r.score,
    source: r.document.metadata.source,
    chunkIndex: r.document.metadata.chunkIndex,
    page: r.document.metadata.page,
    fileId: r.document.metadata.fileId,
    type: r.document.metadata.type
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
