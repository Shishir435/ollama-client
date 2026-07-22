import { useEffect, useRef } from "react"

import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { useChatStream } from "@/features/chat/hooks/use-chat-stream"
import { logger } from "@/lib/logger"
import { completeOnboardingAfterFirstResponse } from "@/lib/onboarding/state"
import { touchMessageActivity } from "@/lib/repositories/chat-history"
import type { ChatMessage } from "@/types"

/**
 * Cadence of the per-turn liveness beat. Must be comfortably below the
 * interrupted sweep's staleness window (20s) with margin for a missed beat, so
 * a live-but-quiet stream (slow/paused provider) is never finalized.
 */
const LIVENESS_BEAT_MS = 8000

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
  const livenessIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const { embedMessages } = useAutoEmbedMessages()

  const stopLivenessBeat = () => {
    if (livenessIntervalRef.current) {
      clearInterval(livenessIntervalRef.current)
      livenessIntervalRef.current = null
    }
  }

  // Keep the streaming row's `updatedAt` fresh on a timer, independent of token
  // arrival, so the interrupted sweep sees a live-but-quiet turn (slow first
  // token, long gaps) as active rather than orphaned. Stops when the turn ends,
  // is stopped, or the panel unmounts — a crash simply lets the beat lapse and
  // the row ages into "orphaned" as intended.
  const startLivenessBeat = (id: number) => {
    if (livenessIntervalRef.current) return
    livenessIntervalRef.current = setInterval(() => {
      touchMessageActivity(id).catch((error) => {
        logger.debug("Liveness beat failed", "useChatStreaming", { error })
      })
    }, LIVENESS_BEAT_MS)
  }

  // Stop the beat if the panel unmounts mid-stream (uses only the stable ref).
  useEffect(
    () => () => {
      if (livenessIntervalRef.current) {
        clearInterval(livenessIntervalRef.current)
        livenessIntervalRef.current = null
      }
    },
    []
  )

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

  const { startStream, stopStream: baseStopStream } = useChatStream({
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
        // Ensure the token-independent liveness beat is running for this turn.
        startLivenessBeat(currentStreamingMessageIdRef.current)
        debouncedDbUpdate(
          currentStreamingMessageIdRef.current,
          streamedMsg.content,
          streamedMsg.thinking
        )
        return
      }

      // Final chunk: stop the liveness beat, flush DB immediately, embed.
      stopLivenessBeat()
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
    setIsStreaming,
    onSuccessfulResponse: async (message) => {
      if (!message.content.trim()) return
      try {
        await completeOnboardingAfterFirstResponse()
      } catch (error) {
        logger.debug("Failed to complete onboarding", "useChatStreaming", {
          error
        })
      }
    }
  })

  const stopStream = () => {
    stopLivenessBeat()
    baseStopStream()
  }

  return { startStream, stopStream, currentStreamingMessageIdRef }
}
