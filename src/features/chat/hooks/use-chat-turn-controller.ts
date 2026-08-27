import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ACTIVITY_LABELS } from "@/application/context/activity-labels"
import {
  capturePermissionResumeSnapshot,
  prepareTurnSubmission
} from "@/application/turns/prepare-turn-submission"
import type { DurableTurnStart } from "@/application/turns/turn-contract"
import {
  buildUserMessage,
  evaluateSendPreconditions,
  resolveTurnModel,
  type TurnToast
} from "@/features/chat/hooks/turn-preparation"
import type { useChatConfig } from "@/features/chat/hooks/use-chat-config"
import type { ChatStreamClaim } from "@/features/chat/hooks/use-chat-stream"
import { findOptionalPermissionNotice } from "@/features/chat/lib/optional-permission-notice"
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
      mode?: Exclude<import("@ollama-client/contracts/turns").TurnMode, "new">
      streamClaim?: ChatStreamClaim
    }
  ) => Promise<boolean>
  claimResponseStream: () => ChatStreamClaim | null
  releaseResponseStreamClaim: (claim: ChatStreamClaim) => void
  toast: ToastFn
}

const preparingActivity = (
  rawInput: string,
  files?: ProcessedFile[]
): ActivityEvent => ({
  id: "preparing-context",
  kind: "preparing_context",
  label: ACTIVITY_LABELS.preparingContext.text,
  labelKey: ACTIVITY_LABELS.preparingContext.key,
  status: "running",
  startedAt: Date.now(),
  inputPreview: rawInput || files?.[0]?.metadata.fileName
})

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
  claimResponseStream,
  releaseResponseStreamClaim,
  toast
}: UseChatTurnControllerOptions) => {
  const [pendingActivityEvents, setPendingActivityEvents] = useState<
    ActivityEvent[]
  >([])
  const { t } = useTranslation()

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

  const releasePreparation = (
    streamClaim: ChatStreamClaim,
    stopStreaming = false
  ) => {
    setPendingActivityEvents([])
    setIsLoading(false)
    if (stopStreaming) setIsStreaming(false)
    releaseResponseStreamClaim(streamClaim)
  }

  const createSession = async (
    streamClaim: ChatStreamClaim
  ): Promise<string | null> => {
    try {
      const sessionId = await ensureSessionId()
      if (!sessionId) releasePreparation(streamClaim)
      return sessionId
    } catch (error) {
      logger.error("Failed to create chat session", "useChat", { error })
      releasePreparation(streamClaim)
      toast({
        variant: "destructive",
        title: t("chat.errors.chat_create_failed_title"),
        description: t("chat.errors.chat_create_failed_description")
      })
      return null
    }
  }

  const persistUserMessage = async ({
    sessionId,
    userMessage,
    customInput,
    streamClaim
  }: {
    sessionId: string
    userMessage: ChatMessage
    customInput?: string
    streamClaim: ChatStreamClaim
  }): Promise<number | null> => {
    try {
      const messageId = await addMessage(sessionId, userMessage)
      if (!customInput) setInput("")
      return messageId
    } catch (error) {
      logger.error("Failed to persist user message", "useChat", { error })
      releasePreparation(streamClaim)
      toast({
        variant: "destructive",
        title: t("chat.errors.message_save_failed_title"),
        description: t("chat.errors.message_save_failed_description")
      })
      return null
    }
  }

  const renameSession = async (sessionId: string, titleContent: string) => {
    try {
      await autoRenameSession(sessionId, titleContent)
    } catch (error) {
      logger.error("Failed to rename chat session", "useChat", { error })
    }
  }

  const persistPermissionNotice = async ({
    sessionId,
    resolvedModel,
    durableTurn,
    permissionNotice,
    streamClaim
  }: {
    sessionId: string
    resolvedModel: string
    durableTurn: DurableTurnStart
    permissionNotice: NonNullable<
      Awaited<ReturnType<typeof findOptionalPermissionNotice>>
    >
    streamClaim: ChatStreamClaim
  }): Promise<boolean> => {
    const feature = t(permissionNotice.labelKey)
    try {
      await addMessage(sessionId, {
        role: "assistant",
        content: t("chat.permissions.disabled_notice", { feature }),
        done: true,
        model: resolvedModel,
        metrics: {
          permissionNotice: {
            ...permissionNotice,
            resume: capturePermissionResumeSnapshot(durableTurn)
          }
        }
      })
      releasePreparation(streamClaim)
      return true
    } catch (error) {
      logger.error("Failed to persist permission notice", "useChat", { error })
      toast({
        variant: "destructive",
        title: t("chat.errors.message_save_failed_title"),
        description: t("chat.errors.message_save_failed_description")
      })
      releasePreparation(streamClaim)
      return false
    }
  }

  const submitResponse = async ({
    customModel,
    sessionId,
    conversationMessages,
    userMessage,
    durableTurn,
    streamClaim
  }: {
    customModel?: string
    sessionId: string
    conversationMessages: ChatMessage[]
    userMessage: ChatMessage
    durableTurn: DurableTurnStart
    streamClaim: ChatStreamClaim
  }): Promise<boolean> => {
    try {
      const submitted = await generateResponse(
        customModel,
        sessionId,
        [...conversationMessages, userMessage],
        { durableTurn, streamClaim }
      )
      if (submitted) {
        setPendingActivityEvents([])
        return true
      }
      releasePreparation(streamClaim, true)
      return false
    } catch (error) {
      logger.error("Failed to submit durable turn", "useChat", { error })
      releasePreparation(streamClaim, true)
      toast({
        variant: "destructive",
        title: t("chat.errors.response_failed_title"),
        description: t("chat.errors.unknown_error_description")
      })
      return false
    }
  }

  const sendMessage = async (
    customInput?: string,
    customModel?: string,
    files?: ProcessedFile[],
    images?: ImageAttachment[]
  ) => {
    const live = loadStreamStore.getState()
    const rawInput = customInput?.trim() ?? input.trim()
    const conversationMessages = messages.filter(
      (message) => !message.metrics?.permissionNotice
    )
    const resolvedModel = resolveTurnModel(
      customModel,
      config.selectedModelRef,
      config.selectedModel
    )
    const verdict = evaluateSendPreconditions({
      isBusy: live.isLoading || live.isStreaming,
      selectionConflictModel: config.selectionConflictModel,
      rawInput,
      hasFiles: Boolean(files?.length),
      hasImages: Boolean(images?.length),
      resolvedModel
    })
    if (!verdict.proceed) {
      if (verdict.toast) showTurnToast(verdict.toast)
      return false
    }

    const permissionNotice = await findOptionalPermissionNotice(rawInput)
    const streamClaim = claimResponseStream()
    if (!streamClaim) return false

    setIsLoading(true)
    setPendingActivityEvents([preparingActivity(rawInput, files)])
    const sessionId = await createSession(streamClaim)
    if (!sessionId) return false

    const userContent = rawInput || ""
    const includeContext = selectedTabIds.length > 0 && Boolean(contextText?.trim())
    const hasTabContext = includeContext && tabDocuments.length > 0
    const userMessage = buildUserMessage({ content: userContent, files, images })
    const userMessageId = await persistUserMessage({
      sessionId,
      userMessage,
      customInput,
      streamClaim
    })
    if (userMessageId === null) return false

    await renameSession(
      sessionId,
      rawInput || files?.[0]?.metadata.fileName || ""
    )

    const turnId =
      globalThis.crypto?.randomUUID?.() ??
      `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const durableTurn = prepareTurnSubmission({
      id: turnId,
      sessionId,
      mode: "new",
      model: resolvedModel,
      selectedModel: config.selectedModel,
      selectedModelRef: config.selectedModelRef,
      customModel,
      memoryEnabled: config.memoryEnabled,
      maxTabContextChars: config.maxTabContextChars,
      maxRagContextChars: config.maxRagContextChars,
      createdAt: Date.now(),
      userMessage,
      userMessageId,
      priorMessages: conversationMessages,
      rawInput: userContent,
      files: files?.map((file) => ({
        text: file.text,
        metadata: {
          fileName: file.metadata.fileName,
          fileId: file.metadata.fileId
        }
      })),
      hasTabContext,
      contextText: contextText || "",
      tabDocuments,
      groundedOnlyMode: config.groundedOnlyMode
    })

    if (permissionNotice) {
      return persistPermissionNotice({
        sessionId,
        resolvedModel,
        durableTurn,
        permissionNotice,
        streamClaim
      })
    }
    return submitResponse({
      customModel,
      sessionId,
      conversationMessages,
      userMessage,
      durableTurn,
      streamClaim
    })
  }

  return { pendingActivityEvents, sendMessage }
}
