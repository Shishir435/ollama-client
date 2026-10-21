import { RefreshCcw, TriangleAlert } from "lucide-react"
import { createElement, memo, Suspense, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useMessageExport } from "@/features/chat/hooks/use-message-export"
import { useRecoveryCooldown } from "@/features/chat/hooks/use-recovery-cooldown"
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

type EmptyReplyKind = "thinking-only" | "no-text"

/**
 * Why a finished assistant turn has nothing to read, or null when it does.
 *
 * The stream's own flags say so when it saw the empty finish. A row without
 * them still counts when the provider reported a completed generation
 * (`eval_count`), which is what a blank answer persisted before those flags,
 * or overwritten after them, looks like. A turn the user stopped has neither
 * and is left alone: nothing went wrong with it.
 */
const emptyReplyKind = (
  message: ChatMessage,
  busy: boolean
): EmptyReplyKind | null => {
  const metrics = message.metrics
  if (message.role !== "assistant" || busy || !message.done) return null
  if (message.error || message.agentRunId || message.content.trim()) {
    return null
  }
  if (metrics?.interrupted || metrics?.permissionNotice) return null
  if ((message.images?.length ?? 0) > 0) return null
  const finished =
    metrics?.thinkingOnlyResponse ||
    metrics?.emptyResponse ||
    typeof metrics?.eval_count === "number"
  if (!finished) return null
  return metrics?.thinkingOnlyResponse || message.thinking?.trim()
    ? "thinking-only"
    : "no-text"
}

const EmptyReplyNotice = ({
  kind,
  onRetry
}: {
  kind: EmptyReplyKind
  onRetry?: () => void
}) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pt-0.5 pb-1 text-xs text-muted-foreground">
      <span>
        {kind === "thinking-only"
          ? t("chat.empty_reply.thinking_only")
          : t("chat.empty_reply.no_text")}
      </span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCcw className="icon-xs" />
          {t("common.actions.retry")}
        </Button>
      )}
    </div>
  )
}

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
    onResolvePermission,
    announceError = false
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
    /** `enable: false` continues without turning the capability on. */
    onResolvePermission?: (enable?: boolean) => Promise<PermissionResumeResult>
    /**
     * Whether a failure here is announced as an alert. Only the latest message
     * should be: every historical failure carrying `role="alert"` makes a
     * screen reader re-announce old errors whenever the list re-renders them.
     */
    announceError?: boolean
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
    const cooldown = useRecoveryCooldown(
      msg.error?.recoveryAction === "wait-retry"
        ? msg.error.retryAfterMs
        : undefined,
      msg.timestamp
    )
    const onRegenerateTurn = agentRow ? undefined : onRegenerate
    const emptyReply = emptyReplyKind(msg, Boolean(isLoading || isStreaming))
    /**
     * An empty answer carries its own Retry beside the explanation, so the
     * footer does not repeat it.
     */
    const canRetry =
      !isUser &&
      (Boolean(msg.error?.retryable) || Boolean(msg.metrics?.interrupted)) &&
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
                {createElement(AgentRunCard, { msg })}
              </Suspense>
            )}
            {showErrorTreatment ? (
              // A failed turn is styled as a failure, not as model output: same
              // copy in the same neutral bubble reads as something the model
              // said. The rail + icon separate the two at a glance.
              <div
                role={announceError ? "alert" : undefined}
                className="mt-0.5 w-full border-l-2 border-destructive/50 pl-2">
                <div className="flex items-center gap-1.5 px-2 pb-0.5 text-micro font-medium text-destructive">
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
              <>
                <ChatMessageContent
                  msg={msg}
                  isUser={isUser}
                  isLoading={isLoading}
                  isStreaming={isStreaming}
                />
                {emptyReply && (
                  <EmptyReplyNotice
                    kind={emptyReply}
                    onRetry={
                      onRegenerateTurn && cooldown === 0
                        ? () => onRegenerateTurn()
                        : undefined
                    }
                  />
                )}
              </>
            )}
            <ChatMessageFooter
              isUser={isUser}
              msg={msg}
              isLoading={isLoading}
              showRetrievedChunks={showRetrievedChunks}
              feedbackEnabled={feedbackEnabled}
              onRegenerate={cooldown > 0 ? undefined : onRegenerateTurn}
              canRetry={canRetry && cooldown === 0}
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
