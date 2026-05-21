import { useCallback, useState } from "react"

import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { getEmbeddableMessagesBySession } from "@/features/chat/utils/embedding-backfill"
import { clearEmbeddingCache } from "@/lib/embeddings/embedding-client"
import { clearAllVectors } from "@/lib/embeddings/vector-store"

export interface RebuildProgress {
  current: number
  total: number
}

export interface UseEmbeddingRebuildOptions {
  /** When true, re-embed all chat messages after clearing vectors. */
  memoryEnabled: boolean
  /** Called twice: before vectors are cleared, and once rebuild is done. */
  onStoreChanged?: () => Promise<void> | void
}

export interface UseEmbeddingRebuildResult {
  isRebuilding: boolean
  progress: RebuildProgress | null
  error: string | null
  complete: boolean
  rebuild: () => Promise<void>
  /** Drop the success state — useful when the user dismisses the success banner. */
  resetComplete: () => void
}

/**
 * "Rebuild all embeddings" flow.
 *
 * Steps:
 *   1. Clear the in-memory embedding cache.
 *   2. Wipe every vector in the store.
 *   3. (When `memoryEnabled`) iterate every session's embeddable
 *      messages and re-embed them in batches, reporting progress.
 *
 * Errors from any step are caught and surfaced via `error`; the hook
 * never throws. `onStoreChanged` fires after the clear and after the
 * rebuild so callers can refresh dependent UI (e.g. dimension stats).
 */
export const useEmbeddingRebuild = ({
  memoryEnabled,
  onStoreChanged
}: UseEmbeddingRebuildOptions): UseEmbeddingRebuildResult => {
  const [isRebuilding, setIsRebuilding] = useState(false)
  const [progress, setProgress] = useState<RebuildProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)

  const { embedMessages } = useAutoEmbedMessages()

  const rebuild = useCallback(async () => {
    setIsRebuilding(true)
    setError(null)
    setComplete(false)
    setProgress(null)

    try {
      clearEmbeddingCache()
      await clearAllVectors()
      await onStoreChanged?.()

      if (memoryEnabled) {
        const { messagesBySession, totalMessages } =
          await getEmbeddableMessagesBySession()
        setProgress({ current: 0, total: totalMessages })

        let processed = 0
        for (const [sessionId, messages] of messagesBySession.entries()) {
          if (messages.length === 0) continue
          await embedMessages(messages, sessionId)
          processed += messages.length
          setProgress({ current: processed, total: totalMessages })
          // Yield to keep the UI responsive between sessions.
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }

      setComplete(true)
      await onStoreChanged?.()
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to rebuild embeddings"
      console.error("Failed to rebuild embeddings:", e)
      setError(message)
    } finally {
      setIsRebuilding(false)
    }
  }, [embedMessages, memoryEnabled, onStoreChanged])

  const resetComplete = useCallback(() => setComplete(false), [])

  return {
    isRebuilding,
    progress,
    error,
    complete,
    rebuild,
    resetComplete
  }
}
