import { CopyButton } from "@/components/copy-button"
import { MarkdownRenderer } from "@/components/markdown-renderer"
import RegenerateButton from "@/components/regenerate-button"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"

export default function ChatMessageBubble({
  msg,
  onRegenerate,
  isLoading
}: {
  msg: ChatMessage
  onRegenerate?: (model: string) => void
  isLoading?: boolean
}) {
  const isUser = msg.role === "user"

  return (
    <div
      className={cn(
        "group flex w-full transition-all duration-200",
        isUser ? "justify-end" : "justify-start"
      )}>
      <div
        className={cn(
          "relative w-full max-w-[90vw] rounded-2xl p-3 text-sm shadow-sm transition-all duration-200 sm:max-w-2xl sm:p-4",
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
        </div>

        {isLoading && !isUser && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex gap-1">
              <div
                className="h-1 w-1 animate-pulse rounded-full bg-current"
                style={{ animationDelay: "0ms" }}
              />
              <div
                className="h-1 w-1 animate-pulse rounded-full bg-current"
                style={{ animationDelay: "150ms" }}
              />
              <div
                className="h-1 w-1 animate-pulse rounded-full bg-current"
                style={{ animationDelay: "300ms" }}
              />
            </div>
            <span>Thinking...</span>
          </div>
        )}

        {msg.role === "assistant" && msg.model && !isLoading && (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-200 pt-2 dark:border-gray-600">
            <div className="flex items-center gap-1">
              <CopyButton text={msg.content} />
              <RegenerateButton
                model={msg.model}
                onSelectModel={(model) => onRegenerate?.(model)}
              />
            </div>

            {/* Model indicator */}
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {msg.model}
            </div>
          </div>
        )}

        {isUser && (
          <div className="absolute -bottom-6 right-2 text-xs text-gray-500 opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:text-gray-400">
            {new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit"
            })}
          </div>
        )}
      </div>
    </div>
  )
}
