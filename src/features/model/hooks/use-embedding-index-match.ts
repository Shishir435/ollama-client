import { liveQuery } from "dexie"
import { useEffect, useState } from "react"
import { hasVectorsForEmbeddingModel } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"

/**
 * Whether the saved index holds vectors from `model`: false after a switch
 * without a rebuild, when search skips every stored row. `null` while unknown,
 * disabled, or unreadable, so the caller claims nothing it did not check.
 *
 * Observed with `liveQuery`, not read once: vectors are written by uploads,
 * the background rebuild and the Options page, none of which this panel
 * starts, and a stale "Not indexed" would ask the user to rebuild files that
 * are already searchable.
 */
export const useEmbeddingIndexMatch = (
  model: string,
  enabled: boolean
): boolean | null => {
  const [result, setResult] = useState<{
    model: string
    match: boolean | null
  } | null>(null)

  useEffect(() => {
    if (!enabled) return
    const subscription = liveQuery(() =>
      hasVectorsForEmbeddingModel(model)
    ).subscribe({
      next: (match) => setResult({ model, match }),
      error: (error: unknown) => {
        logger.error(
          "Failed to read the embedding index model",
          "useEmbeddingIndexMatch",
          { error }
        )
        setResult({ model, match: null })
      }
    })
    return () => subscription.unsubscribe()
  }, [model, enabled])

  /** An answer for another model is no answer. */
  return enabled && result?.model === model ? result.match : null
}
