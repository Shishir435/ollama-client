import type { ChatMessage } from "@/hooks/use-chat"
import { cn } from "@/lib/utils"

import { MarkdownRenderer } from "./markdown-renderer"

export default function ChatMessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user"
  const isShort = msg.content.length < 40 // tweak this threshold as needed

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : isShort ? "justify-start" : "justify-center"
      )}>
      <div
        className={cn(
          "max-w-2xl rounded-xl px-3 py-2 text-sm shadow transition-colors",
          isUser
            ? "max-w-[80%] bg-blue-400 text-white dark:bg-blue-500"
            : "bg-gray-100 text-gray-900 dark:bg-[#1e1e1e] dark:text-gray-100"
        )}>
        <MarkdownRenderer content={msg.content} />
      </div>
    </div>
  )
}
