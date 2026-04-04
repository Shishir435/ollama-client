import { cosineSimilarity } from "@/lib/embeddings/embedding-client"
import { logger } from "@/lib/logger"

export type RerankerBackend = "none" | "cosine"

class RerankerService {
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
    logger.info("Reranker disposed", "RerankerService")
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
          "RerankerService"
        )
        return documents.map((d) => ({ ...d, score: 0.5 }))
      }

      const docsWithEmbedding = documents.filter(
        (d) => d.embedding && Array.isArray(d.embedding)
      )

      if (docsWithEmbedding.length === 0) {
        logger.verbose(
          "No embeddings in documents, using uniform scores",
          "RerankerService"
        )
        return documents.map((d) => ({ ...d, score: 0.5 }))
      }

      const scored = docsWithEmbedding.map((doc) => {
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
        "RerankerService"
      )

      return ranked
    } catch (error) {
      logger.error("Reranking failed, using fallback", "RerankerService", {
        error: error instanceof Error ? error.message : String(error)
      })
      return documents.map((d) => ({ ...d, score: 0.5 }))
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    logger.info(
      `Reranker ${enabled ? "enabled" : "disabled"}`,
      "RerankerService"
    )
  }

  setBackend(backend: RerankerBackend) {
    if (this.backend === backend) return
    this.backend = backend
    logger.info(`Reranker backend set to ${backend}`, "RerankerService")
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

export const rerankerService = new RerankerService()
