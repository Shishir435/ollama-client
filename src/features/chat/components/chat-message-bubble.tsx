import { TriangleAlert } from "lucide-react"
import { memo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMessageExport } from "@/features/chat/hooks/use-message-export"
import type { PermissionResumeResult } from "@/features/chat/lib/resume-permission-turn"
import type { ChatMessage } from "@/types"
import { ChatErrorReportAction } from "./chat-error-report-action"
import { ChatMessageContainer } from "./chat-message-container"
import { ChatMessageContent } from "./chat-message-content"
import { ChatMessageEditor } from "./chat-message-editor"
import { ChatMessageFooter } from "./chat-message-footer"
import { OptionalPermissionNoticeCard } from "./optional-permission-notice-card"

const hasAssistantError = (message: ChatMessage) => Boolean(message.error)

export const ChatMessageBubble = memo(
  ({
    msg,
    sessionId,
    onRegenerate,
    isBusy,
    isLoading,
    isStreaming,
    showRetrievedChunks,
    feedbackEnabled,
    onUpdate,
    onFork,
    onDelete,
    onNavigate,
    onResolvePermission
  }: {
    msg: ChatMessage
    sessionId?: string
    onRegenerate?: (model?: string) => void
    isBusy?: boolean
    isLoading?: boolean
    isStreaming?: boolean
    showRetrievedChunks?: boolean
    feedbackEnabled?: boolean
    onUpdate?: (content: string) => void
    onFork?: (content: string) => void
    onDelete?: () => void
    onNavigate?: (nodeId: number | string) => void
    onResolvePermission?: () => Promise<PermissionResumeResult>
  }) => {
    const { t } = useTranslation()
    const [editorMode, setEditorMode] = useState<"edit" | "fork" | null>(null)
    const isUser = msg.role === "user"
    const permissionNotice = msg.metrics?.permissionNotice
    const showErrorTreatment =
      !isLoading && !isStreaming && hasAssistantError(msg)
    const canRetry =
      !isUser &&
      // An empty answer is retryable for the same reason an interrupted one is:
      // the turn ended without one, and asking again is the whole fix.
      (Boolean(msg.error?.retryable) ||
        Boolean(msg.metrics?.interrupted) ||
        Boolean(msg.metrics?.emptyResponse)) &&
      Boolean(onRegenerate) &&
      !isLoading &&
      !isStreaming

    const handleSave = (newContent: string) => {
      if (editorMode === "fork") onFork?.(newContent)
      else onUpdate?.(newContent)
      setEditorMode(null)
    }

    /* import { useMessageExport } from "@/features/chat/hooks/use-message-export" */

    const { exportMessageAsJson, exportMessageAsPdf } = useMessageExport()

    const handleExport = (format: "json" | "pdf") => {
      switch (format) {
        case "json":
          exportMessageAsJson(msg)
          break
        case "pdf":
          exportMessageAsPdf(msg)
          break
      }
    }

    if (permissionNotice && onResolvePermission) {
      return (
        <ChatMessageContainer isUser={false}>
          <OptionalPermissionNoticeCard
            notice={permissionNotice}
            onEnable={onResolvePermission}
          />
        </ChatMessageContainer>
      )
    }

    return (
      <ChatMessageContainer isUser={isUser}>
        {editorMode ? (
          <ChatMessageEditor
            initialContent={msg.content}
            onSave={handleSave}
            onCancel={() => setEditorMode(null)}
            submitLabel={
              editorMode === "fork" ? t("chat.actions.fork") : t("common.save")
            }
          />
        ) : (
          <>
            {showErrorTreatment ? (
              // A failed turn is styled as a failure, not as model output: same
              // copy in the same neutral bubble reads as something the model
              // said. The rail + icon separate the two at a glance.
              <div
                role="alert"
                className="mt-0.5 w-full border-l-2 border-destructive/50 pl-2">
                <div className="flex items-center gap-1.5 px-2 pb-0.5 text-micro font-medium text-destructive/80">
                  <TriangleAlert className="icon-xs shrink-0" />
                  <span>{t("chat.errors.response_failed_title")}</span>
                </div>
                <ChatMessageContent
                  msg={msg}
                  isUser={isUser}
                  isLoading={isLoading}
                  isStreaming={isStreaming}
                />
                <ChatErrorReportAction
                  msg={msg}
                  sessionId={sessionId}
                  onRetry={onRegenerate ? () => onRegenerate() : undefined}
                />
              </div>
            ) : (
              <ChatMessageContent
                msg={msg}
                isUser={isUser}
                isLoading={isLoading}
                isStreaming={isStreaming}
              />
            )}
            <ChatMessageFooter
              isUser={isUser}
              msg={msg}
              isLoading={isLoading}
              showRetrievedChunks={showRetrievedChunks}
              feedbackEnabled={feedbackEnabled}
              onRegenerate={onRegenerate}
              canRetry={canRetry}
              onEdit={() => setEditorMode("edit")}
              onFork={
                isUser && !isBusy ? () => setEditorMode("fork") : undefined
              }
              onDelete={onDelete}
              onExport={handleExport}
              onNavigate={onNavigate}
            />
          </>
        )}
      </ChatMessageContainer>
    )
  },
  (prev, next) => {
    return (
      prev.msg === next.msg &&
      prev.sessionId === next.sessionId &&
      prev.isBusy === next.isBusy &&
      prev.isLoading === next.isLoading &&
      prev.isStreaming === next.isStreaming &&
      prev.showRetrievedChunks === next.showRetrievedChunks &&
      prev.feedbackEnabled === next.feedbackEnabled &&
      prev.onResolvePermission === next.onResolvePermission
    )
  }
)
