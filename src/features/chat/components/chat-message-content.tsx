import { useTranslation } from "react-i18next"

import { MarkdownRenderer } from "@/components/markdown-renderer"
import { ChatMessageLoadingIndicator } from "@/features/chat/components/chat-message-loading-indicator"
import { FileAttachmentDisplay } from "@/features/chat/components/file-attachment-display"
import { ReasoningTrace } from "@/features/chat/components/reasoning-trace"
import { RunDetails } from "@/features/chat/components/run-details"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"

export const ChatMessageContent = ({
  msg,
  isUser,
  isLoading = false,
  isStreaming = false
}: {
  msg: ChatMessage
  isUser: boolean
  isLoading?: boolean
  isStreaming?: boolean
}) => {
  const { t } = useTranslation()
  const loadingLabel = isStreaming
    ? t("chat.reasoning.loading_typing", "Typing")
    : t("chat.reasoning.loading_queued", "Queued")

  return (
    <div
      className={cn(
        "w-full max-w-[90vw] text-sm sm:max-w-2xl",
        isUser
          ? "rounded-message border border-border/35 bg-app-primary-soft px-3 py-2.5 text-foreground sm:px-4"
          : "py-1 text-foreground"
      )}>
      {/* File Attachments */}
      {msg.attachments && msg.attachments.length > 0 && (
        <FileAttachmentDisplay attachments={msg.attachments} />
      )}
      {!isUser && (
        <ReasoningTrace
          message={msg}
          isLoading={isLoading}
          isStreaming={isStreaming}
        />
      )}
      <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-strong:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90 prose-ul:marker:text-muted-foreground prose-ol:marker:text-muted-foreground">
        <MarkdownRenderer content={msg.content} />
        {isLoading && !isUser && (
          <ChatMessageLoadingIndicator
            label={loadingLabel}
            showDots={isStreaming}
          />
        )}
        {!isUser && msg.done && <RunDetails metrics={msg.metrics} />}
      </div>
    </div>
  )
}
