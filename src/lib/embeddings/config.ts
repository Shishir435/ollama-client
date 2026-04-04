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
