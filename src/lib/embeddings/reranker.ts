import { cosineSimilarity } from "@/lib/embeddings/embedding-client"
import { getErrorMessage } from "@/lib/error-utils"
import { logger } from "@/lib/logger"

export type RerankerBackend = "none" | "cosine"

/**
 * Cosine similarity re-scorer used as a precision pass after hybrid search.
 * This is NOT a cross-encoder reranker — it scores documents using embedding
 * cosine similarity against the query embedding, providing semantic-only
 * ordering independent of the keyword weight used in stage 1 retrieval.
 * Score range: [0, 1] via (cosine + 1) / 2.
 */
class CosineRescorer {
  private enabled: boolean = false
  private backend: RerankerBackend = "none"

  private disposeTimeout: NodeJS.Timeout | null = null
  private readonly DISPOSE_DELAY = 5 * 60 * 1000

  private updateAccess() {
    if (this.disposeTimeout) {
      clearTimeout(this.disposeTimeout)
    }

    this.disposeTimeout = setTimeout(() => {
      this.dispose()
    }, this.DISPOSE_DELAY)
  }

  async dispose() {
    logger.info("Reranker disposed", "CosineRescorer")
  }

  async rerank(
    queryEmbedding: number[],
    documents: Array<{
      content: string
      embedding?: number[]
      metadata?: Record<string, unknown>
    }>,
    topK: number
  ): Promise<
    Array<{
      content: string
      score: number
      metadata?: Record<string, unknown>
    }>
  > {
    this.updateAccess()

    if (!this.enabled || this.backend === "none" || documents.length === 0) {
      return documents.map((d) => ({ ...d, score: 0.5 }))
    }

    try {
      if (!queryEmbedding || queryEmbedding.length === 0) {
        logger.verbose(
          "No query embedding available, using uniform scores",
          "CosineRescorer"
        )
        return documents.map((d) => ({ ...d, score: 0.5 }))
      }

      const hasAnyEmbedding = documents.some(
        (d) =>
          d.embedding && Array.isArray(d.embedding) && d.embedding.length > 0
      )

      if (!hasAnyEmbedding) {
        logger.verbose(
          "No embeddings in documents, using uniform scores",
          "CosineRescorer"
        )
        return documents.map((d) => ({ ...d, score: 0.5 }))
      }

      // Score every document. Documents missing an embedding keep a neutral
      // score instead of being dropped from the result set — dropping them
      // silently lost retrieved context that stage-1 search had selected.
      const scored = documents.map((doc) => {
        if (!doc.embedding || doc.embedding.length === 0) {
          return {
            ...doc,
            score: 0.5
          }
        }

        const similarity = cosineSimilarity(queryEmbedding, doc.embedding)
        return {
          ...doc,
          score: (similarity + 1) / 2
        }
      })

      const ranked = scored.sort((a, b) => b.score - a.score).slice(0, topK)

      logger.info(
        `Cosine reranking complete: top score = ${ranked[0]?.score.toFixed(3)}`,
        "CosineRescorer"
      )

      return ranked
    } catch (error) {
      logger.error("Reranking failed, using fallback", "CosineRescorer", {
        error: getErrorMessage(error)
      })
      return documents.map((d) => ({ ...d, score: 0.5 }))
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    logger.info(
      `Reranker ${enabled ? "enabled" : "disabled"}`,
      "CosineRescorer"
    )
  }

  setBackend(backend: RerankerBackend) {
    if (this.backend === backend) return
    this.backend = backend
    logger.info(`Reranker backend set to ${backend}`, "CosineRescorer")
  }

  setModelName(_modelName: string) {
    // Not used for cosine similarity
  }

  isEnabled(): boolean {
    return this.enabled
  }

  clearCache() {
    this.dispose()
  }
}

export const rerankerService = new CosineRescorer()
