import { TriangleAlert } from "lucide-react"
import { memo, Suspense, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMessageExport } from "@/features/chat/hooks/use-message-export"
import { useAgentRunRenderer } from "@/features/chat/lib/agent-run-renderer"
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
    const AgentRunCard = useAgentRunRenderer()
    const agentRow = !isUser && Boolean(msg.agentRunId)
    const permissionNotice = msg.metrics?.permissionNotice
    const showErrorTreatment =
      !isLoading && !isStreaming && hasAssistantError(msg)
    /**
     * A turn that delegated a browser run is not regenerated: asking again
     * would ask the model to start the task again, beside a run that already
     * acted on a page. The card's own follow-ups are the way to carry on.
     */
    const onRegenerateTurn = agentRow ? undefined : onRegenerate
    const canRetry =
      !isUser &&
      // An empty answer is retryable for the same reason an interrupted one is:
      // the turn ended without one, and asking again is the whole fix.
      (Boolean(msg.error?.retryable) ||
        Boolean(msg.metrics?.interrupted) ||
        Boolean(msg.metrics?.emptyResponse)) &&
      Boolean(onRegenerateTurn) &&
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
            {/*
              A run's card sits above the answer of the turn that started it:
              the run is what the model delegated, the text is what it made
              of the result.
            */}
            {agentRow && AgentRunCard && (
              <Suspense fallback={null}>
                <AgentRunCard msg={msg} />
              </Suspense>
            )}
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
                  onRetry={
                    onRegenerateTurn ? () => onRegenerateTurn() : undefined
                  }
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
              onRegenerate={onRegenerateTurn}
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
