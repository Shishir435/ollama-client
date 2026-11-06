import { useEffect, useState } from "react"
import { hasVectorsForEmbeddingModel } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"

/**
 * Whether the saved index holds vectors from `model`: false after a switch
 * without a rebuild, when search skips every stored row. `null` while unknown,
 * disabled, or unreadable, so the caller claims nothing it did not check.
 * `revision` re-reads after anything that rewrites the index (a rebuild).
 */
export const useEmbeddingIndexMatch = (
  model: string,
  enabled: boolean,
  revision: unknown
): boolean | null => {
  const [result, setResult] = useState<{
    model: string
    revision: unknown
    match: boolean | null
  } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    const settle = (match: boolean | null) => {
      if (active) setResult({ model, revision, match })
    }
    hasVectorsForEmbeddingModel(model)
      .then(settle)
      .catch((error: unknown) => {
        logger.error(
          "Failed to read the embedding index model",
          "useEmbeddingIndexMatch",
          { error }
        )
        settle(null)
      })
    return () => {
      active = false
    }
  }, [model, enabled, revision])

  /** An answer for another model or an older index is no answer. */
  return enabled && result?.model === model && result.revision === revision
    ? result.match
    : null
}
