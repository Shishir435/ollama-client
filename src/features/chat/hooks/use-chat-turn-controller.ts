import { useState } from "react"
import { buildRagContext } from "@/features/chat/hooks/build-rag-context"
import type { useChatConfig } from "@/features/chat/hooks/use-chat-config"
import { loadStreamStore } from "@/features/chat/stores/load-stream-store"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { logger } from "@/lib/logger"
import type {
  ActivityEvent,
  ChatMessage,
  FileAttachment,
  ImageAttachment,
  RagSources,
  SelectedModelRef
} from "@/types"

type ToastFn = (input: {
  variant?: "default" | "destructive"
  title: string
  description?: string
}) => void

interface UseChatTurnControllerOptions {
  config: ReturnType<typeof useChatConfig>
  input: string
  setInput: (value: string) => void
  selectedTabIds: string[]
  contextText: string | undefined
  tabDocuments: Array<{ id: string; title: string; content: string }>
  messages: ChatMessage[]
  setIsLoading: (value: boolean) => void
  setIsStreaming: (value: boolean) => void
  ensureSessionId: () => Promise<string | null>
  autoRenameSession: (sessionId: string, content: string) => Promise<void>
  addMessage: (sessionId: string, message: ChatMessage) => Promise<unknown>
  setNextResponseMetrics: (
    ragSources: RagSources | null,
    promptContextStats: Awaited<
      ReturnType<typeof buildRagContext>
    >["promptContextStats"]
  ) => void
  clearNextResponseMetrics: () => void
  generateResponse: (
    customModel?: string,
    sessionId?: string,
    overrideMessages?: ChatMessage[]
  ) => Promise<void>
  toast: ToastFn
}

const buildFileAttachments = (
  files: ProcessedFile[] | undefined
): FileAttachment[] | undefined =>
  files && files.length > 0
    ? files.map((file) => ({
        fileId: file.metadata.fileId || `file-${Date.now()}-${Math.random()}`,
        fileName: file.metadata.fileName,
        fileType: file.metadata.fileType,
        fileSize: file.metadata.fileSize,
        textPreview: file.text.slice(0, 200),
        processedAt: file.metadata.processedAt
      }))
    : undefined

const modelForAssistantFallback = (
  customModel: string | undefined,
  selectedModelRef: SelectedModelRef | null,
  selectedModel: string
) => customModel || selectedModelRef?.modelId || selectedModel

export const useChatTurnController = ({
  config,
  input,
  setInput,
  selectedTabIds,
  contextText,
  tabDocuments,
  messages,
  setIsLoading,
  setIsStreaming,
  ensureSessionId,
  autoRenameSession,
  addMessage,
  setNextResponseMetrics,
  clearNextResponseMetrics,
  generateResponse,
  toast
}: UseChatTurnControllerOptions) => {
  const [pendingActivityEvents, setPendingActivityEvents] = useState<
    ActivityEvent[]
  >([])

  const sendMessage = async (
    customInput?: string,
    customModel?: string,
    files?: ProcessedFile[],
    images?: ImageAttachment[]
  ) => {
    const live = loadStreamStore.getState()
    if (live.isLoading || live.isStreaming) return

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

    setIsLoading(true)
    const preparingEvent: ActivityEvent = {
      id: "preparing-context",
      kind: "preparing_context",
      label: "Preparing context",
      status: "running",
      startedAt: Date.now(),
      inputPreview: rawInput || files?.[0]?.metadata.fileName
    }
    setPendingActivityEvents([preparingEvent])

    const sessionId = await ensureSessionId()
    if (!sessionId) {
      setPendingActivityEvents([])
      setIsLoading(false)
      return
    }

    const includeContext = selectedTabIds.length > 0 && !!contextText?.trim()
    const userContent = rawInput || ""
    const hasTabContext = includeContext && tabDocuments.length > 0
    const userMessage: ChatMessage = {
      role: "user",
      content: userContent,
      attachments: buildFileAttachments(files),
      images: hasImages ? images : undefined
    }

    try {
      await addMessage(sessionId, userMessage)

      if (!customInput) setInput("")

      const titleContent = rawInput || files?.[0]?.metadata.fileName || ""
      await autoRenameSession(sessionId, titleContent)
    } catch (error) {
      logger.error("Failed to persist user message", "useChat", { error })
      setPendingActivityEvents([])
      setIsLoading(false)
      toast({
        variant: "destructive",
        title: "Couldn't send message",
        description: "Saving the message failed. Please try again."
      })
      return
    }

    let ragResult: Awaited<ReturnType<typeof buildRagContext>>
    try {
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
        onActivityEvent: (events) => {
          setPendingActivityEvents([
            {
              ...preparingEvent,
              status: "done",
              finishedAt: Date.now()
            },
            ...events
          ])
        },
        toast
      })
    } catch (error) {
      logger.error("Failed to build chat context", "useChat", { error })
      clearNextResponseMetrics()
      setPendingActivityEvents([])
      setIsLoading(false)
      setIsStreaming(false)

      try {
        await addMessage(sessionId, {
          role: "assistant",
          content:
            "I couldn't prepare the context for this message. Please try again, or reduce the selected context/files if this keeps happening.",
          done: true,
          model: modelForAssistantFallback(
            customModel,
            config.selectedModelRef,
            config.selectedModel
          ),
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
      setIsLoading(false)
      setPendingActivityEvents([])
      const settingsDeepLink =
        "/options.html?tab=context&focus=grounded-only-mode"

      await addMessage(sessionId, {
        role: "assistant",
        content: `Insufficient page context. Select at least one tab with relevant extracted content and try again.\n\nIf you want to disable this behavior, go to [Settings > Context > Answer only from selected page context](${settingsDeepLink}).`,
        done: true,
        model: modelForAssistantFallback(
          customModel,
          config.selectedModelRef,
          config.selectedModel
        ),
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
    setPendingActivityEvents([
      {
        ...preparingEvent,
        status: "done",
        finishedAt: Date.now()
      },
      ...promptContextStats.activityEvents,
      {
        id: "generating-answer",
        kind: "generating_answer",
        label: "Generating answer",
        status: "running",
        startedAt: Date.now()
      }
    ])

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
    setPendingActivityEvents([])
  }

  return { pendingActivityEvents, sendMessage }
}
