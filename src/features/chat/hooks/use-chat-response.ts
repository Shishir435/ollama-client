import { useRef } from "react"
import type {
  PromptContextStats,
  RagSources
} from "@/features/chat/hooks/build-rag-context"
import type { useChatConfig } from "@/features/chat/hooks/use-chat-config"
import type { ChatMessage } from "@/types"

interface ChatResponseOptions {
  config: ReturnType<typeof useChatConfig>
  currentSessionId: string | null
  messages: ChatMessage[]
  addMessage: (sessionId: string, message: ChatMessage) => Promise<number>
  startStream: (options: {
    model: string
    providerId?: string
    messages: ChatMessage[]
    sessionId: string
    generatedMessage: ChatMessage
  }) => void
  currentStreamingMessageIdRef: { current: number | null }
}

export const useChatResponse = ({
  config,
  currentSessionId,
  messages,
  addMessage,
  startStream,
  currentStreamingMessageIdRef
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
    contextMessages?: ChatMessage[]
  ) => {
    const sessionId = sessionIdParam || currentSessionId
    if (!sessionId) return

    const modelForRequest =
      customModel || config.selectedModelRef?.modelId || config.selectedModel
    if (!modelForRequest) return

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
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

    startStream({
      model: modelForRequest,
      providerId: config.selectedModelRef?.providerId,
      messages: contextMessages || messages,
      sessionId,
      generatedMessage: { ...assistantMessage, id: assistantId }
    })
  }

  return {
    generateResponse,
    setNextResponseMetrics,
    clearNextResponseMetrics
  }
}
