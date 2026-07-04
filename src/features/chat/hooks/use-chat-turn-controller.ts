import { useState } from "react"
import { buildRagContext } from "@/features/chat/hooks/build-rag-context"
import {
  buildUserMessage,
  evaluateSendPreconditions,
  resolveTurnModel,
  type TurnToast
} from "@/features/chat/hooks/turn-preparation"
import type { useChatConfig } from "@/features/chat/hooks/use-chat-config"
import { loadStreamStore } from "@/features/chat/stores/load-stream-store"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { logger } from "@/lib/logger"
import type {
  ActivityEvent,
  ChatMessage,
  ImageAttachment,
  RagSources
} from "@/types"

type ToastFn = (input: TurnToast) => void

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
    overrideMessages?: ChatMessage[],
    agentMode?: boolean
  ) => Promise<void>
  toast: ToastFn
}

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
    images?: ImageAttachment[],
    agentMode = false
  ) => {
    const live = loadStreamStore.getState()
    const rawInput = customInput?.trim() ?? input.trim()
    const hasImages = !!images && images.length > 0
    const resolvedModel = resolveTurnModel(
      customModel,
      config.selectedModelRef,
      config.selectedModel
    )

    const verdict = evaluateSendPreconditions({
      isBusy: live.isLoading || live.isStreaming,
      selectionConflictModel: config.selectionConflictModel,
      rawInput,
      hasFiles: !!files && files.length > 0,
      hasImages,
      resolvedModel
    })
    if (!verdict.proceed) {
      if (verdict.toast) toast(verdict.toast)
      return
    }

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
    const userMessage = buildUserMessage({
      content: userContent,
      files,
      images
    })

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
          model: resolvedModel,
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
        "/options.html?tab=knowledge&focus=grounded-only-mode"

      await addMessage(sessionId, {
        role: "assistant",
        content: `Insufficient page context. Select at least one tab with relevant extracted content and try again.\n\nIf you want to disable this behavior, go to [Settings > Context > Answer only from selected page context](${settingsDeepLink}).`,
        done: true,
        model: resolvedModel,
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

    if (agentMode) {
      await generateResponse(customModel, sessionId, messagesForLLM, true)
    } else {
      await generateResponse(customModel, sessionId, messagesForLLM)
    }
    setPendingActivityEvents([])
  }

  return { pendingActivityEvents, sendMessage }
}
