import { useState } from "react"

import { MarkdownRenderer } from "@/components/markdown-renderer"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import { ChatMessageLoadingIndicator } from "@/features/chat/components/chat-message-loading-indicator"
import { ChatMessageMetrics } from "@/features/chat/components/chat-message-metrics"
import { FileAttachmentDisplay } from "@/features/chat/components/file-attachment-display"
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
  const [showThinking, setShowThinking] = useState(false)

  const hasThinking = !isUser && Boolean(msg.thinking?.trim())
  return (
    <div
      className={cn(
        "w-full max-w-[90vw] rounded-xl p-3 text-sm shadow-xs sm:max-w-2xl sm:p-4",
        "hover:shadow-md",
        isUser
          ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
          : "bg-gray-50 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
        "border",
        isUser
          ? "border-gray-300 dark:border-gray-600"
          : "border-gray-200 dark:border-gray-700"
      )}>
      {/* File Attachments */}
      {msg.attachments && msg.attachments.length > 0 && (
        <FileAttachmentDisplay attachments={msg.attachments} />
      )}
      {hasThinking && (
        <Collapsible
          open={showThinking}
          onOpenChange={setShowThinking}
          className="mb-2 rounded-lg border border-dashed border-border/60 bg-muted/30 p-2 text-xs">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="h-auto w-full justify-between px-2 py-1 text-muted-foreground">
              <span>Thinking</span>
              <span>{showThinking ? "Hide" : "Show"}</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-sm text-foreground">
            <MarkdownRenderer content={msg.thinking ?? ""} />
          </CollapsibleContent>
        </Collapsible>
      )}
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
