import { useEffect, useRef } from "react"
import { buildRagContext } from "@/features/chat/hooks/build-rag-context"
import { useChatConfig } from "@/features/chat/hooks/use-chat-config"
import { useChatResponse } from "@/features/chat/hooks/use-chat-response"
import { useChatSessionLifecycle } from "@/features/chat/hooks/use-chat-session-lifecycle"
import { useChatStreaming } from "@/features/chat/hooks/use-chat-streaming"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useTabContent } from "@/features/tabs/stores/tab-content-store"
import { useToast } from "@/hooks/use-toast"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { logger } from "@/lib/logger"
import type { ChatMessage, FileAttachment, ImageAttachment } from "@/types"

export const useChat = () => {
  const config = useChatConfig()
  const { toast } = useToast()

  const { input, setInput } = useChatInput()
  const { selectedTabIds, setSelectedTabIds } = useSelectedTabs()
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
  const previousSessionIdRef = useRef<string | null>(null)

  const currentSession = sessions.find((s) => s.id === currentSessionId)
  const messages = currentSession?.messages ?? []

  const { startStream, stopStream, currentStreamingMessageIdRef } =
    useChatStreaming({
      currentSessionId,
      updateMessage,
      setIsLoading,
      setIsStreaming
    })

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    if (
      previousSessionIdRef.current &&
      currentSessionId &&
      previousSessionIdRef.current !== currentSessionId &&
      selectedTabIds.length > 0
    ) {
      setSelectedTabIds([])
    }
    previousSessionIdRef.current = currentSessionId
  }, [currentSessionId, selectedTabIds.length, setSelectedTabIds])

  const { ensureSessionId, autoRenameSession } = useChatSessionLifecycle({
    currentSessionId,
    sessions,
    createSession,
    setCurrentSessionId,
    renameSessionTitle
  })

  const { generateResponse, setNextResponseMetrics, clearNextResponseMetrics } =
    useChatResponse({
      config,
      currentSessionId,
      messages,
      addMessage,
      startStream,
      currentStreamingMessageIdRef
    })

  const sendMessage = async (
    customInput?: string,
    customModel?: string,
    files?: ProcessedFile[],
    images?: ImageAttachment[]
  ) => {
    // Block re-entrancy: ignore a send while a generation is already in flight
    // so a slow turn can't have a second query queued behind it.
    if (isLoading || isStreaming) return

    const rawInput = customInput?.trim() ?? input.trim()

    if (config.selectionConflictModel) {
      toast({
        variant: "destructive",
        title: "Model provider selection required",
        description: `Select a provider for "${config.selectionConflictModel}" in the model menu before sending a message.`
      })
      return
    }

    const hasImages = !!images && images.length > 0
    if (!rawInput && (!files || files.length === 0) && !hasImages) return

    // Show the thinking state immediately, before any await — session
    // creation, context building (RAG embedding, vector search) all run before
    // the stream starts, and without this the user gets no feedback for that
    // whole window, assumes nothing happened, and re-sends.
    setIsLoading(true)

    const sessionId = await ensureSessionId()
    if (!sessionId) {
      setIsLoading(false)
      return
    }

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
      attachments,
      images: hasImages ? images : undefined
    }
    await addMessage(sessionId, userMessage)

    if (!customInput) setInput("")

    const titleContent = rawInput || files?.[0]?.metadata.fileName || ""
    await autoRenameSession(sessionId, titleContent)

    let ragResult: Awaited<ReturnType<typeof buildRagContext>>
    try {
      // Build the RAG-augmented body in the background.
      ragResult = await buildRagContext({
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
    } catch (error) {
      logger.error("Failed to build chat context", "useChat", { error })
      clearNextResponseMetrics()
      setIsLoading(false)
      setIsStreaming(false)

      try {
        await addMessage(sessionId, {
          role: "assistant",
          content:
            "I couldn't prepare the context for this message. Please try again, or reduce the selected context/files if this keeps happening.",
          done: true,
          model:
            customModel ||
            config.selectedModelRef?.modelId ||
            config.selectedModel,
          metrics: {
            contextBuildFailed: true
          }
        })
      } catch (messageError) {
        logger.error(
          "Failed to persist context preparation error message",
          "useChat",
          { error: messageError }
        )
      }

      toast({
        variant: "destructive",
        title: "Context preparation failed",
        description:
          "The message was saved, but the assistant could not start because context preparation failed."
      })
      return
    }

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
      // Early exit without streaming — clear the thinking state we set above.
      setIsLoading(false)
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

    setNextResponseMetrics(ragSources, promptContextStats)

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
