import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { BuildRagContextResult } from "@/features/chat/hooks/build-rag-context"
import {
  buildUserMessage,
  evaluateSendPreconditions,
  resolveTurnModel,
  type TurnToast
} from "@/features/chat/hooks/turn-preparation"
import { useBuildContext } from "@/features/chat/hooks/use-build-context"
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
    promptContextStats: BuildRagContextResult["promptContextStats"]
  ) => void
  clearNextResponseMetrics: () => void
  generateResponse: (
    customModel?: string,
    sessionId?: string,
    overrideMessages?: ChatMessage[],
    options?: { contextPrepared?: boolean }
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
  const { buildContext } = useBuildContext()
  const { t } = useTranslation()

  /** Resolves a pure module's key-named toast into displayable copy. */
  const showTurnToast = (turnToast: TurnToast) => {
    toast({
      ...(turnToast.variant ? { variant: turnToast.variant } : {}),
      title: t(turnToast.titleKey),
      ...(turnToast.descriptionKey
        ? {
            description: t(
              turnToast.descriptionKey,
              turnToast.descriptionValues
            )
          }
        : {})
    })
  }

  const sendMessage = async (
    customInput?: string,
    customModel?: string,
    files?: ProcessedFile[],
    images?: ImageAttachment[]
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
      if (verdict.toast) showTurnToast(verdict.toast)
      return false
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

    let sessionId: string | null
    try {
      sessionId = await ensureSessionId()
    } catch (error) {
      logger.error("Failed to create chat session", "useChat", { error })
      setPendingActivityEvents([])
      setIsLoading(false)
      toast({
        variant: "destructive",
        title: t("chat.errors.chat_create_failed_title"),
        description: t("chat.errors.chat_create_failed_description")
      })
      return false
    }
    if (!sessionId) {
      setPendingActivityEvents([])
      setIsLoading(false)
      return false
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
    } catch (error) {
      logger.error("Failed to persist user message", "useChat", { error })
      setPendingActivityEvents([])
      setIsLoading(false)
      toast({
        variant: "destructive",
        title: t("chat.errors.message_save_failed_title"),
        description: t("chat.errors.message_save_failed_description")
      })
      return false
    }

    const titleContent = rawInput || files?.[0]?.metadata.fileName || ""
    try {
      await autoRenameSession(sessionId, titleContent)
    } catch (error) {
      // Title generation is cosmetic. The message is durable and should still
      // proceed to context building and model generation.
      logger.error("Failed to rename chat session", "useChat", { error })
    }

    let ragResult: BuildRagContextResult
    try {
      ragResult = await buildContext(
        {
          rawInput: userContent,
          // Ship only what context building needs: scope id + text for the
          // full-text fallback. Keeps the port payload small.
          files: files?.map((file) => ({
            text: file.text,
            metadata: {
              fileName: file.metadata.fileName,
              fileId: file.metadata.fileId
            }
          })),
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
          customModel
        },
        {
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
          toast: showTurnToast
        }
      )
    } catch (error) {
      logger.error("Failed to build chat context", "useChat", { error })
      clearNextResponseMetrics()
      setPendingActivityEvents([])
      setIsLoading(false)
      setIsStreaming(false)

      try {
        await addMessage(sessionId, {
          role: "assistant",
          content: t("chat.errors.context_preparation_failed"),
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
        title: t("chat.errors.context_preparation_failed_title"),
        description: t("chat.errors.context_preparation_failed_description")
      })
      return true
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
        // The link text is the setting's own label, so renaming the setting
        // cannot leave this message naming something the user cannot find.
        content: t("chat.errors.insufficient_page_context", {
          settingsLabel: t("settings.grounding_mode.label"),
          settingsLink: settingsDeepLink
        }),
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
      return true
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
        title: t("chat.errors.context_trimmed_title"),
        description: t("chat.errors.context_trimmed_description")
      })
    }

    // The UI just built page/file/memory context into `messagesForLLM`, so tell
    // the background not to run its own memory retrieval (which would double-
    // inject memory and embed the RAG-augmented prompt instead of the raw query).
    await generateResponse(customModel, sessionId, messagesForLLM, {
      contextPrepared: true
    })
    setPendingActivityEvents([])
    return true
  }

  return { pendingActivityEvents, sendMessage }
}
