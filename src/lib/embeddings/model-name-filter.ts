import { RECOMMENDED_EMBEDDING_MODELS } from "@/lib/constants"

/**
 * Heuristics for "is this model name likely an embedding model?"
 *
 * Pulled out of the embedding-settings UI so the same filter can be
 * reused by other surfaces (model picker dropdowns, status indicators,
 * future model-suggestion flows) without duplicating the keyword list.
 *
 * The implementation is intentionally permissive — we'd rather show a
 * non-embedding model in the embedding picker than hide a legitimate
 * one — because the runtime check (`MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL`)
 * is the authoritative gate.
 */

/** Recommended embedding-model names normalized to lowercase. */
export const recommendedEmbeddingModelSet = new Set(
  RECOMMENDED_EMBEDDING_MODELS.map((m) => m.toLowerCase())
)

/** The recommended set keyed by the bit before the `:` tag (e.g. `nomic-embed-text` from `nomic-embed-text:latest`). */
export const recommendedEmbeddingBaseSet = new Set(
  RECOMMENDED_EMBEDDING_MODELS.map((m) => m.toLowerCase().split(":")[0])
)

/**
 * Family-name keywords that strongly suggest "this is an embedding model"
 * even when the model isn't in our recommended list. Used as a fallback
 * after the exact / base-name match misses.
 */
const EMBEDDING_NAME_KEYWORDS = [
  "embed",
  "embedding",
  "bge",
  "e5",
  "gte",
  "jina",
  "minilm",
  "sentence-transformers"
] as const

/**
 * True if `modelName` looks like an embedding model by name alone.
 * Order of checks:
 *   1. Exact match against the recommended list.
 *   2. Base-name (pre-`:`) match against the recommended list.
 *   3. Substring match against the family-name keyword list.
 */
export const isLikelyEmbeddingModelName = (modelName: string): boolean => {
  const normalized = modelName.toLowerCase()
  const base = normalized.split(":")[0] || normalized

  if (
    recommendedEmbeddingModelSet.has(normalized) ||
    recommendedEmbeddingBaseSet.has(base)
  ) {
    return true
  }

  for (const keyword of EMBEDDING_NAME_KEYWORDS) {
    if (normalized.includes(keyword)) return true
  }

  return false
}
