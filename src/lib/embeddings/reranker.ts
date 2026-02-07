import {
  env,
  pipeline,
  type TextClassificationPipeline
} from "@xenova/transformers"
import { logger } from "@/lib/logger"

// Configure transformers.js to use CDN models
env.allowLocalModels = false
env.allowRemoteModels = true

/**
 * Re-ranker service using transformers.js cross-encoder models
 *
 * ⚠️ DISABLED BY DEFAULT in Chrome extensions due to CSP constraints
 * Transformers.js requires worker blob URLs which violate extension CSP
 * Falls back to similarity-only scoring
 */
class RerankerService {
  private model: TextClassificationPipeline | null = null
  private loading: Promise<TextClassificationPipeline> | null = null
  private enabled: boolean = false // DISABLED: CSP prevents transformers.js in extensions
  private modelName = "Xenova/bge-reranker-base"

  private disposeTimeout: NodeJS.Timeout | null = null
  private readonly DISPOSE_DELAY = 5 * 60 * 1000 // 5 minutes

  private updateAccess() {
    if (this.disposeTimeout) {
      clearTimeout(this.disposeTimeout)
    }

    this.disposeTimeout = setTimeout(() => {
      this.dispose()
    }, this.DISPOSE_DELAY)
  }

  /**
   * Get or load the re-ranker model (lazy loading)
   */
  async getModel(): Promise<TextClassificationPipeline> {
    this.updateAccess()

    if (this.model) return this.model
    if (this.loading) return this.loading

    this.loading = this.loadModel()
    this.model = await this.loading
    this.loading = null
    return this.model
  }

  /**
   * Load the re-ranker model with WebGPU fallback
   */
  private async loadModel(): Promise<TextClassificationPipeline> {
    logger.info(
      `Loading transformers.js re-ranker: ${this.modelName}`,
      "RerankerService"
    )

    try {
      // Load the model (transformers.js handles device selection automatically)
      // WebGPU is used automatically if available, otherwise falls back to WASM
      const model = await pipeline("text-classification", this.modelName)

      logger.info("✅ Re-ranker model loaded successfully", "RerankerService")
      return model
    } catch (error) {
      logger.error("Failed to load re-ranker model", "RerankerService", {
        error
      })
      throw new Error("Re-ranker model failed to load")
    }
  }

  /**
   * Dispose the model to free memory
   */
  async dispose() {
    if (!this.model && !this.loading) return

    logger.info("Auto-disposing unused re-ranker model...", "RerankerService")

    // Clear references
    this.model = null
    this.loading = null

    // Explicitly try to dispose if the library supports it
    try {
      // This is a best-effort attempt to clear memory in the underlying engine
      if (env.backends?.onnx?.sessions) {
        // Placeholder for deep cleanup if needed
      }
    } catch (_e) {
      // ignore
    }

    logger.info("Re-ranker disposed (memory freed)", "RerankerService")
  }

  /**
   * Re-rank documents using cross-encoder relevance scoring
   *
   * @param query - User query
   * @param documents - Candidate documents to re-rank
   * @param topK - Number of top results to return
   * @returns Sorted documents with relevance scores
   */
  async rerank(
    query: string,
    documents: Array<{ content: string; metadata?: Record<string, unknown> }>,
    topK: number
  ): Promise<
    Array<{
      content: string
      score: number
      metadata?: Record<string, unknown>
    }>
  > {
    this.updateAccess()

    if (!this.enabled || documents.length === 0) {
      return documents.map((d) => ({ ...d, score: 0.5 }))
    }

    try {
      const model = await this.getModel()

      logger.verbose(
        `Re-ranking ${documents.length} documents`,
        "RerankerService"
      )

      // Batch score all query-document pairs
      const scores = await Promise.all(
        documents.map(async (doc) => {
          // Cross-encoder inputs: query and document concatenated
          // Format: "query [SEP] document" (model handles special tokens)
          const input = `${query} [SEP] ${doc.content}`
          const result = (await model(input)) as Array<{
            label: string
            score: number
          }>

          // Extract relevance score (typically the positive class)
          const score = result[0]?.score || 0.5

          return {
            ...doc,
            score
          }
        })
      )

      // Sort by relevance score (descending) and return top-K
      const ranked = scores.sort((a, b) => b.score - a.score).slice(0, topK)

      logger.info(
        `Re-ranking complete: top score = ${ranked[0]?.score.toFixed(3)}`,
        "RerankerService"
      )

      return ranked
    } catch (error) {
      logger.error(
        "Re-ranking failed, returning original order",
        "RerankerService",
        { error }
      )
      // Graceful fallback: return documents as-is
      return documents.map((d) => ({ ...d, score: 0.5 }))
    }
  }

  /**
   * Enable or disable re-ranking
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled
    logger.info(
      `Re-ranker ${enabled ? "enabled" : "disabled"}`,
      "RerankerService"
    )
  }

  /**
   * Check if re-ranker is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Clear cached model (for testing or debugging)
   */
  clearCache() {
    this.dispose()
  }
}

// Singleton instance
export const rerankerService = new RerankerService()
