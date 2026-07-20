import { useEffect, useRef } from "react"

import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { useChatStream } from "@/features/chat/hooks/use-chat-stream"
import {
  beatStreamingHeartbeat,
  clearStreamingHeartbeat
} from "@/features/chat/lib/streaming-heartbeat"
import { logger } from "@/lib/logger"
import type { ChatMessage } from "@/types"

/** Throttle heartbeat writes to shared storage while streaming. */
const HEARTBEAT_INTERVAL_MS = 3000

interface ChatStreamingOptions {
  currentSessionId: string | null
  updateMessage: (
    messageId: number,
    updates: Partial<ChatMessage>,
    skipDb?: boolean
  ) => Promise<void>
  setIsLoading: (loading: boolean) => void
  setIsStreaming: (streaming: boolean) => void
}

/**
 * Streaming bridge: subscribes to `useChatStream`, updates UI state
 * immediately, and debounces DB writes to ~1s while a stream is in
 * flight. Flushes the final write synchronously on `done`.
 *
 * `currentStreamingMessageIdRef` is exposed so the parent hook can stamp
 * a freshly-created assistant message id on the active stream cycle.
 */
export const useChatStreaming = ({
  currentSessionId,
  updateMessage,
  setIsLoading,
  setIsStreaming
}: ChatStreamingOptions) => {
  const currentStreamingMessageIdRef = useRef<number | null>(null)
  const dbUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastHeartbeatRef = useRef(0)

  const { embedMessages } = useAutoEmbedMessages()

  // Clear the cross-panel streaming heartbeat when this panel unloads, so a
  // reload recovers interrupted turns immediately instead of waiting for the
  // stale timeout. A crash (no pagehide) still ages out via the timestamp.
  useEffect(() => {
    const onPageHide = () => {
      void clearStreamingHeartbeat()
    }
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [])

  const debouncedDbUpdate = (
    id: number,
    content: string,
    thinking?: string
  ) => {
    if (dbUpdateTimeoutRef.current) {
      clearTimeout(dbUpdateTimeoutRef.current)
    }
    dbUpdateTimeoutRef.current = setTimeout(() => {
      updateMessage(id, { content, thinking }, false) // false = write to DB
    }, 1000)
  }

  const { startStream, stopStream } = useChatStream({
    setMessages: async (newMessages) => {
      if (!currentStreamingMessageIdRef.current || newMessages.length === 0) {
        return
      }

      const streamedMsg =
        newMessages.find(
          (m) => m.id === currentStreamingMessageIdRef.current
        ) || newMessages[newMessages.length - 1]
      if (!streamedMsg) return

      // Fast path: update local state only, skipping the DB write.
      updateMessage(
        currentStreamingMessageIdRef.current,
        {
          content: streamedMsg.content,
          thinking: streamedMsg.thinking,
          replayArtifact: streamedMsg.replayArtifact,
          metrics: streamedMsg.metrics,
          done: streamedMsg.done
        },
        true
      )

      if (!streamedMsg.done) {
        // Refresh the cross-panel liveness signal (throttled) so another
        // panel's interrupted-turn sweep won't treat this live turn as orphaned.
        const now = Date.now()
        if (now - lastHeartbeatRef.current > HEARTBEAT_INTERVAL_MS) {
          lastHeartbeatRef.current = now
          void beatStreamingHeartbeat()
        }
        debouncedDbUpdate(
          currentStreamingMessageIdRef.current,
          streamedMsg.content,
          streamedMsg.thinking
        )
        return
      }

      // Final chunk: flush DB immediately and trigger background embedding.
      lastHeartbeatRef.current = 0
      void clearStreamingHeartbeat()
      if (dbUpdateTimeoutRef.current) {
        clearTimeout(dbUpdateTimeoutRef.current)
      }
      await updateMessage(
        currentStreamingMessageIdRef.current,
        {
          content: streamedMsg.content,
          thinking: streamedMsg.thinking,
          replayArtifact: streamedMsg.replayArtifact,
          metrics: streamedMsg.metrics,
          done: true
        },
        false
      )

      if (currentSessionId) {
        embedMessages(newMessages, currentSessionId, false).catch((err) => {
          logger.error("Failed to embed messages", "useChat", { error: err })
        })
      }
    },
    setIsLoading,
    setIsStreaming
  })

  // Clear the heartbeat on an explicit stop; the underlying stream tears down
  // without a `done:true` chunk, so the debounced clear above may not fire.
  const stopStreamWithHeartbeat = () => {
    lastHeartbeatRef.current = 0
    void clearStreamingHeartbeat()
    stopStream()
  }

  return {
    startStream,
    stopStream: stopStreamWithHeartbeat,
    currentStreamingMessageIdRef
  }
}
