import { useTranslation } from "react-i18next"

import { MarkdownRenderer } from "@/components/markdown-renderer"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"
import { ChatMessageLoadingIndicator } from "./chat-message-loading-indicator"
import { FileAttachmentDisplay } from "./file-attachment-display"
import { ReasoningTrace, shouldShowReasoningTrace } from "./reasoning-trace"

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
    ? t("chat.reasoning.loading_typing")
    : t("chat.reasoning.loading_queued")
  const showReasoningTrace =
    !isUser && shouldShowReasoningTrace(msg, isLoading, isStreaming)

  return (
    <div
      className={cn(
        "text-sm",
        isUser
          ? "ml-auto w-fit max-w-[88vw] rounded-message border border-border/20 bg-surface-message/85 px-3 py-2.5 text-foreground shadow-xs sm:max-w-[min(46rem,74%)] sm:px-4"
          : "w-full max-w-[90vw] py-1 text-foreground sm:max-w-2xl"
      )}>
      {/* File Attachments */}
      {msg.attachments && msg.attachments.length > 0 && (
        <FileAttachmentDisplay attachments={msg.attachments} />
      )}
      {showReasoningTrace && (
        <ReasoningTrace
          message={msg}
          isLoading={isLoading}
          isStreaming={isStreaming}
        />
      )}
      <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-strong:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90 prose-ul:marker:text-muted-foreground prose-ol:marker:text-muted-foreground">
        <MarkdownRenderer content={msg.content} />
        {isLoading && !isUser && !showReasoningTrace && (
          <ChatMessageLoadingIndicator
            label={loadingLabel}
            showDots={isStreaming}
          />
        )}
      </div>
    </div>
  )
}
