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

type GenerateOptions = {
  contextPrepared?: boolean
  durableTurn?: DurableTurnStart
  mode?: Exclude<TurnMode, "new">
  streamClaim?: ChatStreamClaim
}

const buildAssistantMessage = (
  model: string,
  ragSources: RagSources | null,
  promptContextStats: PromptContextStats | null
): ChatMessage => ({
  role: "assistant",
  content: "",
  done: false,
  model,
  metrics: ragSources
    ? {
        ragSources: ragSources.sources,
        ragQuery: ragSources.query,
        ...(promptContextStats || {})
      }
    : promptContextStats || undefined
})

const buildDurableTurn = ({
  existing,
  contextMessages,
  sessionId,
  model,
  customModel,
  mode,
  config
}: {
  existing?: DurableTurnStart
  contextMessages?: ChatMessage[]
  sessionId: string
  model: string
  customModel?: string
  mode?: Exclude<TurnMode, "new">
  config: ReturnType<typeof useChatConfig>
}): DurableTurnStart | undefined => {
  if (existing || !contextMessages) return existing
  const turnId =
    globalThis.crypto?.randomUUID?.() ??
    `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return prepareTurnSubmission({
    id: turnId,
    sessionId,
    mode: mode ?? "regenerate",
    model,
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

  const rejectBeforeClaim = (claim?: ChatStreamClaim): false => {
    if (claim) releaseStreamClaim(claim)
    return false
  }

  const generateResponse = async (
    customModel?: string,
    sessionIdParam?: string,
    contextMessages?: ChatMessage[],
    options?: GenerateOptions
  ): Promise<boolean> => {
    const sessionId = sessionIdParam || currentSessionId
    if (!sessionId) return rejectBeforeClaim(options?.streamClaim)

    const modelForRequest =
      customModel || config.selectedModelRef?.modelId || config.selectedModel
    if (!modelForRequest) return rejectBeforeClaim(options?.streamClaim)

    const streamClaim = options?.streamClaim ?? claimStream()
    if (!streamClaim) return false

    try {
      const assistantMessage = buildAssistantMessage(
        modelForRequest,
        ragSourcesRef.current,
        promptContextStatsRef.current
      )
      clearNextResponseMetrics()

      const assistantId = await addMessage(sessionId, assistantMessage)
      currentStreamingMessageIdRef.current = assistantId
      currentStreamingSessionIdRef.current = sessionId
      const durableTurn = buildDurableTurn({
        existing: options?.durableTurn,
        contextMessages,
        sessionId,
        model: modelForRequest,
        customModel,
        mode: options?.mode,
        config
      })

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
      if (!started) throw new Error("Reserved chat stream could not start")
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
