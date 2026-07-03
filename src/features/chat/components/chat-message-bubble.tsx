import { memo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useMessageExport } from "@/features/chat/hooks/use-message-export"
import { buildErrorReportUrl } from "@/lib/error-report"
import { Bug, RefreshCcw } from "@/lib/lucide-icon"
import type { ChatMessage } from "@/types"
import { ChatMessageContainer } from "./chat-message-container"
import { ChatMessageContent } from "./chat-message-content"
import { ChatMessageEditor } from "./chat-message-editor"
import { ChatMessageFooter } from "./chat-message-footer"

export const ChatMessageBubble = memo(
  ({
    msg,
    onRegenerate,
    isLoading,
    isStreaming,
    showRetrievedChunks,
    feedbackEnabled,
    onUpdate,
    onFork,
    onDelete,
    onNavigate
  }: {
    msg: ChatMessage
    onRegenerate?: (model?: string) => void
    isLoading?: boolean
    isStreaming?: boolean
    showRetrievedChunks?: boolean
    feedbackEnabled?: boolean
    onUpdate?: (content: string) => void
    onFork?: (content: string) => void
    onDelete?: () => void
    onNavigate?: (nodeId: number | string) => void
  }) => {
    const { t } = useTranslation()
    const [editorMode, setEditorMode] = useState<"edit" | "fork" | null>(null)
    const isUser = msg.role === "user"
    const canRetry =
      !isUser &&
      Boolean(msg.error?.retryable) &&
      Boolean(onRegenerate) &&
      !isLoading &&
      !isStreaming
    // Every terminal error offers a prefilled GitHub issue — a frustrated
    // user's easiest next click should be the tracker, not a store review.
    const canReport =
      !isUser && Boolean(msg.error) && !isLoading && !isStreaming

    const handleSave = (newContent: string) => {
      if (editorMode === "fork") onFork?.(newContent)
      else onUpdate?.(newContent)
      setEditorMode(null)
    }

    /* import { useMessageExport } from "@/features/chat/hooks/use-message-export" */

    const {
      exportMessageAsJson,
      exportMessageAsMarkdown,
      exportMessageAsPdf,
      exportMessageAsText
    } = useMessageExport()

    const handleExport = (format: "json" | "pdf" | "markdown" | "text") => {
      switch (format) {
        case "json":
          exportMessageAsJson(msg)
          break
        case "pdf":
          exportMessageAsPdf(msg)
          break
        case "markdown":
          exportMessageAsMarkdown(msg)
          break
        case "text":
          exportMessageAsText(msg)
          break
      }
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
            <ChatMessageContent
              msg={msg}
              isUser={isUser}
              isLoading={isLoading}
              isStreaming={isStreaming}
            />
            {(canRetry || canReport) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {canRetry && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    onClick={() => onRegenerate?.()}>
                    <RefreshCcw className="icon-xs" />
                    {t("common.actions.retry")}
                  </Button>
                )}
                {canReport && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground"
                    render={
                      // biome-ignore lint/a11y/useAnchorContent: Base UI's render prop injects the Button's children (icon + label) into this anchor at runtime.
                      <a
                        aria-label={t("chat.errors.report_issue")}
                        href={buildErrorReportUrl({
                          status: msg.error?.status,
                          kind: msg.error?.kind,
                          message: msg.content
                        })}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }>
                    <Bug className="icon-xs" />
                    {t("chat.errors.report_issue")}
                  </Button>
                )}
              </div>
            )}
            <ChatMessageFooter
              isUser={isUser}
              msg={msg}
              isLoading={isLoading}
              showRetrievedChunks={showRetrievedChunks}
              feedbackEnabled={feedbackEnabled}
              onRegenerate={onRegenerate}
              onEdit={() => setEditorMode("edit")}
              onFork={isUser ? () => setEditorMode("fork") : undefined}
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
      prev.isLoading === next.isLoading &&
      prev.isStreaming === next.isStreaming &&
      prev.showRetrievedChunks === next.showRetrievedChunks &&
      prev.feedbackEnabled === next.feedbackEnabled
    )
  }
)
