import type { TextClassificationPipeline } from "@xenova/transformers"
import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"

export type RerankerBackend = "none" | "transformers-js" | "onnxruntime-web"

// Configure transformers.js to use CDN models
// Moved to loadModel to avoid top-level import side-effects
// env.allowLocalModels = false
// env.allowRemoteModels = true

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
  private enabled: boolean = false // Disabled by default in config
  private backend: RerankerBackend = "none"
  private modelName = "Xenova/bge-reranker-base"
  private forceDevice: "webgpu" | "wasm" | undefined = undefined

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
      const { env, pipeline } = await import("@xenova/transformers")

      // Configure environment for Chrome extension
      // Allow remote models from HuggingFace (fetching, not executing remote code)
      env.allowLocalModels = true
      env.allowRemoteModels = true
      env.useBrowserCache = true

      // Point to bundled ONNX Runtime WASM files
      if (env.backends?.onnx?.wasm && browser?.runtime?.getURL) {
        const wasmPath = browser.runtime.getURL("assets/onnxruntime/")
        env.backends.onnx.wasm.wasmPaths = wasmPath
        logger.info(`ONNX WASM path configured: ${wasmPath}`, "RerankerService")
      }

      // Load model - let transformers.js auto-detect (WASM for extension)
      logger.info(
        `Loading re-ranker model: ${this.modelName}`,
        "RerankerService"
      )

      const model = await pipeline("text-classification", this.modelName)

      logger.info("✅ Re-ranker model loaded successfully", "RerankerService")
      return model
    } catch (error) {
      // Graceful fallback - disable reranker if it fails to load
      logger.error(
        "Failed to load re-ranker model, disabling reranker",
        "RerankerService",
        {
          error: error instanceof Error ? error.message : String(error)
        }
      )
      this.enabled = false
      return null
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
    // Explicitly try to dispose if the library supports it
    try {
      const { env } = await import("@xenova/transformers")
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

    if (!this.enabled || this.backend === "none" || documents.length === 0) {
      return documents.map((d) => ({ ...d, score: 0.5 }))
    }

    try {
      if (this.backend === "onnxruntime-web") {
        // Transformers.js uses ONNX runtime under the hood; force WASM device.
        this.forceDevice = "wasm"
      } else {
        this.forceDevice = undefined
      }

      const model = await this.getModel()

      // If model failed to load, return original order with default score
      if (!model) {
        logger.warn(
          "Re-ranker model not available, skipping re-ranking",
          "RerankerService"
        )
        return documents.map((d) => ({ ...d, score: 0.5 }))
      }

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

  setBackend(backend: RerankerBackend) {
    if (this.backend === backend) return
    this.backend = backend
    this.clearCache()
    logger.info(`Re-ranker backend set to ${backend}`, "RerankerService")
  }

  setModelName(modelName: string) {
    if (!modelName || this.modelName === modelName) return
    this.modelName = modelName
    this.clearCache()
    logger.info(`Re-ranker model set to ${modelName}`, "RerankerService")
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
