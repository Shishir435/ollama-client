import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { DurableTurnStart } from "@/application/turns/turn-contract"
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
import type { ActivityEvent, ChatMessage, ImageAttachment } from "@/types"

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
  addMessage: (sessionId: string, message: ChatMessage) => Promise<number>
  generateResponse: (
    customModel?: string,
    sessionId?: string,
    overrideMessages?: ChatMessage[],
    options?: {
      contextPrepared?: boolean
      durableTurn?: DurableTurnStart
      mode?: import("@/application/turns/turn-contract").TurnMode
    }
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
  generateResponse,
  toast
}: UseChatTurnControllerOptions) => {
  const [pendingActivityEvents, setPendingActivityEvents] = useState<
    ActivityEvent[]
  >([])
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

    let userMessageId: number
    try {
      userMessageId = await addMessage(sessionId, userMessage)

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

    const turnId =
      globalThis.crypto?.randomUUID?.() ??
      `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const contextRequest = {
      rawInput: userContent,
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
    }

    const durableTurn: DurableTurnStart = {
      submission: {
        id: turnId,
        sessionId,
        mode: "new",
        model: resolvedModel,
        providerId: config.selectedModelRef?.providerId,
        request: { version: 1, context: contextRequest, userMessage },
        createdAt: Date.now()
      },
      userMessageId
    }

    try {
      await generateResponse(
        customModel,
        sessionId,
        [...messages, userMessage],
        {
          durableTurn
        }
      )
    } catch (error) {
      logger.error("Failed to submit durable turn", "useChat", { error })
      setIsLoading(false)
      setIsStreaming(false)
      toast({
        variant: "destructive",
        title: t("chat.errors.response_failed_title"),
        description: t("chat.errors.unknown_error_description")
      })
      return false
    }
    setPendingActivityEvents([])
    return true
  }

  return { pendingActivityEvents, sendMessage }
}
