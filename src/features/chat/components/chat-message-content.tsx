import { MarkdownRenderer } from "@/components/markdown-renderer"
import { ChatMessageLoadingIndicator } from "@/features/chat/components/chat-message-loading-indicator"
import { ChatMessageMetrics } from "@/features/chat/components/chat-message-metrics"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"

export const ChatMessageContent = ({
  msg,
  isUser
}: {
  msg: ChatMessage
  isUser: boolean
}) => {
  const { isLoading, isStreaming } = useLoadStream()
  return (
    <div
      className={cn(
        "w-full max-w-[90vw] rounded-xl p-3 text-sm shadow-sm sm:max-w-2xl sm:p-4",
        "hover:shadow-md",
        isUser
          ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
          : "bg-gray-50 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
        "border",
        isUser
          ? "border-gray-300 dark:border-gray-600"
          : "border-gray-200 dark:border-gray-700"
      )}>
      <div className="prose prose-sm prose-gray max-w-none dark:prose-invert">
        <MarkdownRenderer content={msg.content} />
        {isLoading && !isUser && (
          <ChatMessageLoadingIndicator
            label={isStreaming ? "Typing" : "Queued"}
            showDots={isStreaming}
          />
        )}
        {!isUser && msg.done && msg.metrics && (
          <ChatMessageMetrics metrics={msg.metrics} />
        )}
      </div>
    </div>
  )
}
