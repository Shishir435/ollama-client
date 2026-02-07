import {
  ensureEmbeddingReadyUnified,
  generateBatchEmbeddingsUnified,
  getEmbeddingCapabilitiesUnified
} from "@/lib/embeddings/embedder-factory"
import type {
  Embedder,
  EmbedderCapabilities,
  EmbedderReadiness,
  EmbeddingRequest,
  EmbeddingResponse
} from "./interfaces"

/**
 * Browser-safe embedder adapter for the RAG core contract.
 * Uses the existing embedding strategy chain without leaking provider details.
 */
export class BrowserEmbedder implements Embedder {
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const result = await generateBatchEmbeddingsUnified(request.texts)
    if ("error" in result) {
      throw new Error(result.error)
    }

    return {
      vectors: result.map((r) => r.embedding),
      model: result[0]?.model || "unknown",
      dimension: result[0]?.dimension || 0
    }
  }

  async getCapabilities(): Promise<EmbedderCapabilities> {
    const capabilities = await getEmbeddingCapabilitiesUnified()
    return {
      nativeEmbeddingsAvailable: capabilities.providerNativeAvailable,
      sharedModelAvailable: capabilities.sharedProviderAvailable,
      fallbackAvailable: capabilities.defaultFallbackAvailable
    }
  }

  async ensureReady(): Promise<EmbedderReadiness> {
    const readiness = await ensureEmbeddingReadyUnified()
    return {
      ready: readiness.ready,
      warmingUp: readiness.warmingUp,
      details: readiness.details
    }
  }
}
