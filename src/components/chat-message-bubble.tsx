import { CopyButton } from "@/components/copy-button"
import { MarkdownRenderer } from "@/components/markdown-renderer"
import RegenerateButton from "@/components/regenerate-button"
import { SpeakButton } from "@/components/speak-button"
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
        "group flex w-full flex-col items-start transition-all duration-200",
        isUser && "items-end"
      )}>
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
        </div>

        {isLoading && !isUser && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex gap-1">
              <div className="h-1 w-1 animate-pulse rounded-full bg-current" />
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
      </div>

      {/* Footer Tools */}
      <div
        className={cn(
          "mt-1 flex w-full max-w-[85vw] items-center justify-between text-xs text-gray-500 sm:max-w-2xl",
          isUser ? "flex-row-reverse" : "flex-row"
        )}>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <CopyButton text={msg.content} />
          <SpeakButton text={msg.content} />
          {!isUser && msg.model && !isLoading && (
            <RegenerateButton
              model={msg.model}
              onSelectModel={(model) => onRegenerate?.(model)}
            />
          )}
        </div>

        <div className="pt-1 text-[11px] opacity-70">
          {isUser
            ? new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              })
            : msg.model || ""}
        </div>
      </div>
    </div>
  )
}
