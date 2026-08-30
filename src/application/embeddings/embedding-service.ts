import {
  clearEmbeddingCache,
  cosineSimilarity,
  type EmbeddingError,
  type EmbeddingResult,
  generateEmbedding,
  generateEmbeddingsBatch,
  getCacheStats
} from "@/lib/embeddings/embedding-client"

/**
 * Background embedding use-case seam.
 *
 * Strategy/cache migration will move behind this service incrementally. New
 * background callers use this module; extension pages use typed RPC instead
 * of resolving providers or credentials in-page.
 */
export const EmbeddingService = {
  generate: generateEmbedding,
  generateBatch: generateEmbeddingsBatch,
  clearCache: clearEmbeddingCache,
  getCacheStats
}

export type { EmbeddingError, EmbeddingResult }
/** Named exports keep existing application seams stable while callers migrate. */
export {
  clearEmbeddingCache,
  cosineSimilarity,
  generateEmbedding,
  generateEmbeddingsBatch,
  getCacheStats
}
