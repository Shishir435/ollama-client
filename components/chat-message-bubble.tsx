import type { ChatMessage } from "@/hooks/use-chat"
import { cn } from "@/lib/utils"

import { CopyButton } from "./copy-button"
import { MarkdownRenderer } from "./markdown-renderer"
import RegenerateButton from "./regenerate-button"

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
  const isShort = msg.content.length < 40

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : isShort ? "justify-start" : "justify-center"
      )}>
      <div
        className={cn(
          "max-w-2xl rounded-xl p-2 text-sm shadow transition-colors",
          isUser
            ? "bg-gray-200 text-gray-900 dark:bg-gray-900 dark:text-gray-100"
            : "bg-gray-100 text-gray-900 dark:bg-zinc-900 dark:text-zinc-100"
        )}>
        <MarkdownRenderer content={msg.content} />

        {msg.role === "assistant" && msg.model && !isLoading && (
          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground dark:text-zinc-400">
            <CopyButton text={msg.content} />
            <RegenerateButton
              model={msg.model}
              onSelectModel={(model) => onRegenerate?.(model)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
