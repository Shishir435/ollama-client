import type { TurnMode } from "@ollama-client/contracts/turns"
import { useRef } from "react"
import type {
  PromptContextStats,
  RagSources
} from "@/application/context/build-context"
import { prepareTurnSubmission } from "@/application/turns/prepare-turn-submission"
import type { DurableTurnStart } from "@/application/turns/turn-contract"
import type { useChatConfig } from "@/features/chat/hooks/use-chat-config"
import type { ChatStreamClaim } from "@/features/chat/hooks/use-chat-stream"
import type { ChatMessage } from "@/types"

interface ChatResponseOptions {
  config: ReturnType<typeof useChatConfig>
  currentSessionId: string | null
  messages: ChatMessage[]
  addMessage: (sessionId: string, message: ChatMessage) => Promise<number>
  startStream: (
    options: {
      model: string
      providerId?: string
      messages: ChatMessage[]
      sessionId: string
      generatedMessage: ChatMessage
      clientContextPrepared?: boolean
      durableTurn?: DurableTurnStart & { assistantMessageId: number }
    },
    claim: ChatStreamClaim
  ) => boolean
  claimStream: () => ChatStreamClaim | null
  releaseStreamClaim: (claim: ChatStreamClaim) => void
  currentStreamingMessageIdRef: { current: number | null }
  currentStreamingSessionIdRef: { current: string | null }
}

export const useChatResponse = ({
  config,
  currentSessionId,
  messages,
  addMessage,
  startStream,
  claimStream,
  releaseStreamClaim,
  currentStreamingMessageIdRef,
  currentStreamingSessionIdRef
}: ChatResponseOptions) => {
  const ragSourcesRef = useRef<RagSources | null>(null)
  const promptContextStatsRef = useRef<PromptContextStats | null>(null)

  const setNextResponseMetrics = (
    ragSources: RagSources | null,
    promptContextStats: PromptContextStats | null
  ) => {
    ragSourcesRef.current = ragSources
    promptContextStatsRef.current = promptContextStats
  }

  const clearNextResponseMetrics = () => {
    setNextResponseMetrics(null, null)
  }

  const generateResponse = async (
    customModel?: string,
    sessionIdParam?: string,
    contextMessages?: ChatMessage[],
    options?: {
      contextPrepared?: boolean
      durableTurn?: DurableTurnStart
      mode?: Exclude<TurnMode, "new">
      streamClaim?: ChatStreamClaim
    }
  ): Promise<boolean> => {
    const sessionId = sessionIdParam || currentSessionId
    if (!sessionId) {
      if (options?.streamClaim) releaseStreamClaim(options.streamClaim)
      return false
    }

    const modelForRequest =
      customModel || config.selectedModelRef?.modelId || config.selectedModel
    if (!modelForRequest) {
      if (options?.streamClaim) releaseStreamClaim(options.streamClaim)
      return false
    }

    const streamClaim = options?.streamClaim ?? claimStream()
    if (!streamClaim) return false

    try {
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: "",
        // Persist the in-flight turn as not-done so a worker/sidepanel death
        // mid-stream leaves a `done=0` row. Startup recovery finalizes any such
        // orphan (marking it interrupted); a normal completion flips it to done.
        done: false,
        model: modelForRequest,
        metrics: ragSourcesRef.current
          ? {
              ragSources: ragSourcesRef.current.sources,
              ragQuery: ragSourcesRef.current.query,
              ...(promptContextStatsRef.current || {})
            }
          : promptContextStatsRef.current || undefined
      }
      clearNextResponseMetrics()

      const assistantId = await addMessage(sessionId, assistantMessage)
      currentStreamingMessageIdRef.current = assistantId
      currentStreamingSessionIdRef.current = sessionId

      let durableTurn = options?.durableTurn
      if (!durableTurn && contextMessages) {
        const turnId =
          globalThis.crypto?.randomUUID?.() ??
          `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`
        durableTurn = prepareTurnSubmission({
          id: turnId,
          sessionId,
          mode: options?.mode ?? "regenerate",
          model: modelForRequest,
          selectedModel: config.selectedModel,
          selectedModelRef: config.selectedModelRef,
          customModel,
          memoryEnabled: config.memoryEnabled,
          maxTabContextChars: config.maxTabContextChars,
          maxRagContextChars: config.maxRagContextChars,
          createdAt: Date.now(),
          contextMessages
        })
      }

      const started = startStream(
        {
          model: modelForRequest,
          providerId: config.selectedModelRef?.providerId,
          messages: contextMessages || messages,
          sessionId,
          generatedMessage: { ...assistantMessage, id: assistantId },
          clientContextPrepared: options?.contextPrepared ?? false,
          durableTurn: durableTurn
            ? { ...durableTurn, assistantMessageId: assistantId }
            : undefined
        },
        streamClaim
      )
      if (!started) {
        throw new Error("Reserved chat stream could not start")
      }
      return true
    } catch (error) {
      releaseStreamClaim(streamClaim)
      throw error
    }
  }

  return {
    generateResponse,
    setNextResponseMetrics,
    clearNextResponseMetrics
  }
}
