import { useEffect, useRef } from "react"
import type {
  PromptContextStats,
  RagSources
} from "@/features/chat/hooks/build-rag-context"
import { buildRagContext } from "@/features/chat/hooks/build-rag-context"
import { useChatConfig } from "@/features/chat/hooks/use-chat-config"
import { useChatStreaming } from "@/features/chat/hooks/use-chat-streaming"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useTabContent } from "@/features/tabs/stores/tab-content-store"
import { useToast } from "@/hooks/use-toast"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { logger } from "@/lib/logger"
import { getLatestSession } from "@/lib/repositories/chat-history"
import type { ChatMessage, FileAttachment } from "@/types"

export const useChat = () => {
  const config = useChatConfig()
  const { toast } = useToast()

  const { input, setInput } = useChatInput()
  const { selectedTabIds } = useSelectedTabs()
  const { builtContent: contextText, documents: tabDocuments } = useTabContent()
  const { isLoading, setIsLoading, isStreaming, setIsStreaming } =
    useLoadStream()

  const {
    currentSessionId,
    sessions,
    addMessage,
    updateMessage,
    renameSessionTitle,
    createSession,
    setCurrentSessionId,
    hasMoreMessages,
    loadMoreMessages
  } = useChatSessions()

  const scrollRef = useRef<HTMLDivElement>(null)

  const currentSession = sessions.find((s) => s.id === currentSessionId)
  const messages = currentSession?.messages ?? []

  const { startStream, stopStream, currentStreamingMessageIdRef } =
    useChatStreaming({
      currentSessionId,
      updateMessage,
      setIsLoading,
      setIsStreaming
    })

  // Carry RAG sources + prompt stats from sendMessage() → generateResponse()
  // so they can be attached to the assistant placeholder message.
  const ragSourcesRef = useRef<RagSources | null>(null)
  const promptContextStatsRef = useRef<PromptContextStats | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  const ensureSessionId = async (): Promise<string | null> => {
    if (currentSessionId) return currentSessionId
    await createSession()
    const latest = await getLatestSession()
    if (!latest) return null
    setCurrentSessionId(latest.id)
    return latest.id
  }

  const autoRenameSession = async (sessionId: string, content: string) => {
    const currentTitle = sessions.find((s) => s.id === sessionId)?.title
    if (currentTitle === "New Chat") {
      const firstLine = content.split("\n")[0].slice(0, 40)
      await renameSessionTitle(sessionId, firstLine)
    }
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
    ragSourcesRef.current = null
    promptContextStatsRef.current = null

    const assistantId = await addMessage(sessionId, assistantMessage)
    currentStreamingMessageIdRef.current = assistantId

    const history = contextMessages || messages

    startStream({
      model: modelForRequest,
      providerId: config.selectedModelRef?.providerId,
      messages: history,
      sessionId,
      generatedMessage: { ...assistantMessage, id: assistantId }
    })
  }

  const sendMessage = async (
    customInput?: string,
    customModel?: string,
    files?: ProcessedFile[]
  ) => {
    const sessionId = await ensureSessionId()
    if (!sessionId) return

    const rawInput = customInput?.trim() ?? input.trim()

    if (config.selectionConflictModel) {
      toast({
        variant: "destructive",
        title: "Model provider selection required",
        description: `Select a provider for "${config.selectionConflictModel}" in the model menu before sending a message.`
      })
      return
    }

    if (!rawInput && (!files || files.length === 0)) return

    const includeContext = selectedTabIds.length > 0 && !!contextText?.trim()
    const userContent = rawInput || ""
    const hasTabContext = includeContext && tabDocuments.length > 0

    const attachments: FileAttachment[] | undefined =
      files && files.length > 0
        ? files.map((file) => ({
            fileId:
              file.metadata.fileId || `file-${Date.now()}-${Math.random()}`,
            fileName: file.metadata.fileName,
            fileType: file.metadata.fileType,
            fileSize: file.metadata.fileSize,
            textPreview: file.text.slice(0, 200),
            processedAt: file.metadata.processedAt
          }))
        : undefined

    // Display user message immediately (instant feedback).
    const userMessage: ChatMessage = {
      role: "user",
      content: userContent,
      attachments
    }
    await addMessage(sessionId, userMessage)

    if (!customInput) setInput("")

    const titleContent = rawInput || files?.[0]?.metadata.fileName || ""
    await autoRenameSession(sessionId, titleContent)

    // Build the RAG-augmented body in the background.
    const ragResult = await buildRagContext({
      rawInput: userContent,
      files,
      messages,
      hasTabContext,
      contextText: contextText || "",
      tabDocuments,
      memoryEnabled: config.memoryEnabled,
      maxTabContextChars: config.maxTabContextChars,
      maxRagContextChars: config.maxRagContextChars,
      groundedOnlyMode: config.groundedOnlyMode,
      selectedModel: config.selectedModel,
      selectedModelRef: config.selectedModelRef,
      customModel,
      toast
    })

    let { contentWithRAG } = ragResult
    const { ragSources, promptContextStats } = ragResult

    const hasRelevantPageContext = promptContextStats.tabContextLength > 0
    if (config.groundedOnlyMode) {
      const strictGroundingInstruction =
        'You must answer only from the supplied selected-page context. If context is insufficient, respond with: "Insufficient page context."'
      contentWithRAG = `${strictGroundingInstruction}\n\n${contentWithRAG}`
      promptContextStats.promptAugmentedLength = contentWithRAG.length
    }

    if (config.groundedOnlyMode && !hasRelevantPageContext) {
      const settingsDeepLink =
        "/options.html?tab=context&focus=grounded-only-mode"

      await addMessage(sessionId, {
        role: "assistant",
        content: `Insufficient page context. Select at least one tab with relevant extracted content and try again.\n\nIf you want to disable this behavior, go to [Settings > Context > Answer only from selected page context](${settingsDeepLink}).`,
        done: true,
        model:
          customModel ||
          config.selectedModelRef?.modelId ||
          config.selectedModel,
        metrics: {
          groundedOnlyMode: true,
          insufficientContext: true,
          promptInputLength: userContent.length,
          promptAugmentedLength: contentWithRAG.length,
          tabContextLength: promptContextStats.tabContextLength,
          ragContextLength: promptContextStats.ragContextLength,
          tabContextTruncated: promptContextStats.tabContextTruncated,
          usedContextChunks: promptContextStats.usedContextChunks
        }
      })
      return
    }

    const messagesForLLM = [
      ...messages,
      { ...userMessage, content: contentWithRAG }
    ]

    ragSourcesRef.current = ragSources
    promptContextStatsRef.current = promptContextStats

    logger.info("Prompt context stats", "useChat", {
      sessionId,
      promptInputLength: promptContextStats.promptInputLength,
      promptAugmentedLength: promptContextStats.promptAugmentedLength,
      tabContextLength: promptContextStats.tabContextLength,
      ragContextLength: promptContextStats.ragContextLength,
      tabContextTruncated: promptContextStats.tabContextTruncated,
      groundedOnlyMode: config.groundedOnlyMode,
      usedContextChunkCount: promptContextStats.usedContextChunks.length
    })

    if (promptContextStats.tabContextTruncated) {
      toast({
        title: "Context trimmed",
        description:
          "Extracted tab context exceeded your limit and was trimmed before sending."
      })
    }

    await generateResponse(customModel, sessionId, messagesForLLM)
  }

  return {
    messages,
    isLoading,
    isStreaming,
    sendMessage,
    generateResponse,
    stopGeneration: stopStream,
    scrollRef,
    hasMore: hasMoreMessages,
    onLoadMore: loadMoreMessages
  }
}
