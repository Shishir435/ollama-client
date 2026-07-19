import { memo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMessageExport } from "@/features/chat/hooks/use-message-export"
import type { ChatMessage } from "@/types"
import { ChatMessageContainer } from "./chat-message-container"
import { ChatMessageContent } from "./chat-message-content"
import { ChatMessageEditor } from "./chat-message-editor"
import { ChatMessageFooter } from "./chat-message-footer"

const hasAssistantError = (message: ChatMessage) => Boolean(message.error)

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
            <ChatMessageFooter
              isUser={isUser}
              msg={msg}
              isLoading={isLoading}
              showRetrievedChunks={showRetrievedChunks}
              feedbackEnabled={feedbackEnabled}
              onRegenerate={onRegenerate}
              canRetry={canRetry}
              canReport={!isLoading && !isStreaming && hasAssistantError(msg)}
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
