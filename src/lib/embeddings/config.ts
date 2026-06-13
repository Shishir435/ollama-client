import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

/**
 * Gets embedding configuration
 */
export const getEmbeddingConfig = async (): Promise<EmbeddingConfig> => {
  const stored = await plasmoGlobalStorage.get<EmbeddingConfig>(
    STORAGE_KEYS.EMBEDDINGS.CONFIG
  )
  const merged: EmbeddingConfig = {
    ...DEFAULT_EMBEDDING_CONFIG,
    ...stored
  }

  const rawAnnBackend = merged.annBackend as string | undefined
  const annBackend: EmbeddingConfig["annBackend"] =
    rawAnnBackend === "bruteforce" ? "bruteforce" : "ts-hnsw"

  // Migration shim: earlier builds experimented with a transformers.js /
  // onnxruntime-web cross-encoder reranker, but MV3 CSP blocked it, so the only
  // shipped backend is cosine re-scoring (see lib/embeddings/reranker.ts).
  // Old stored configs may still hold those backend strings — collapse them to
  // "cosine" rather than silently disabling reranking for those users.
  const rawRerankerBackend = merged.rerankerBackend as string | undefined
  const rerankerBackend: EmbeddingConfig["rerankerBackend"] =
    rawRerankerBackend === "cosine" ||
    rawRerankerBackend === "transformers-js" ||
    rawRerankerBackend === "onnxruntime-web"
      ? "cosine"
      : "none"

  return {
    ...merged,
    annBackend,
    rerankerBackend:
      merged.useReranking && rerankerBackend === "none"
        ? "cosine"
        : rerankerBackend
  }
}
