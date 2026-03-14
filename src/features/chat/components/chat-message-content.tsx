import { useEffect, useMemo, useState } from "react"

import { MarkdownRenderer } from "@/components/markdown-renderer"
import { ChatMessageLoadingIndicator } from "@/features/chat/components/chat-message-loading-indicator"
import { ChatMessageMetrics } from "@/features/chat/components/chat-message-metrics"
import { FileAttachmentDisplay } from "@/features/chat/components/file-attachment-display"
import { Brain, ChevronDown } from "@/lib/lucide-icon"
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
  const [showThinking, setShowThinking] = useState(false)
  const [userToggledThinking, setUserToggledThinking] = useState(false)

  const hasThinking = !isUser && Boolean(msg.thinking?.trim())
  const showThinkingIndicator =
    !isUser && isLoading && Boolean(msg.thinking?.trim()) && !msg.content.trim()
  const loadingLabel = showThinkingIndicator
    ? "Thinking"
    : isStreaming
      ? "Typing"
      : "Queued"

  const thinkingPreview = useMemo(() => {
    if (!hasThinking) return ""
    const text = msg.thinking?.trim() || ""
    if (text.length <= 220) return text
    return `${text.slice(0, 220)}...`
  }, [hasThinking, msg.thinking])

  const reasoningId = useMemo(() => {
    const base = msg.id ?? msg.timestamp ?? "message"
    return `reasoning-${String(base)}`
  }, [msg.id, msg.timestamp])
  const reasoningButtonId = useMemo(() => {
    const base = msg.id ?? msg.timestamp ?? "message"
    return `reasoning-button-${String(base)}`
  }, [msg.id, msg.timestamp])
  const messageKey = `${msg.id ?? ""}:${msg.timestamp ?? ""}`

  useEffect(() => {
    void messageKey
    setUserToggledThinking(false)
    setShowThinking(false)
  }, [messageKey])

  useEffect(() => {
    if (isUser || !hasThinking || userToggledThinking) return
    const autoOpen = isStreaming || showThinkingIndicator
    setShowThinking(autoOpen)
  }, [
    hasThinking,
    isStreaming,
    isUser,
    showThinkingIndicator,
    userToggledThinking
  ])

  useEffect(() => {
    if (isUser || userToggledThinking) return
    if (!isStreaming && !isLoading) {
      setShowThinking(false)
    }
  }, [isLoading, isStreaming, isUser, userToggledThinking])

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
        <section
          aria-label="Model reasoning"
          className="group mb-3 rounded-lg border border-border/80 bg-background/80 px-3 py-2">
          <button
            type="button"
            id={reasoningButtonId}
            aria-expanded={showThinking}
            aria-controls={reasoningId}
            className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
            onClick={() => {
              setShowThinking((prev) => !prev)
              setUserToggledThinking(true)
            }}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Brain className="size-3" />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-[11px] font-semibold tracking-wide uppercase">
                  Reasoning trace
                </span>
                {!showThinking && thinkingPreview && (
                  <span className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                    {thinkingPreview}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {showThinkingIndicator && (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                  <span className="inline-flex size-1.5 animate-pulse rounded-full bg-emerald-400" />
                  Thinking…
                </span>
              )}
              {!showThinkingIndicator && !isStreaming && !isLoading && (
                <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                  Done
                </span>
              )}
              <span className="flex items-center gap-1 text-[11px]">
                <span>{showThinking ? "Hide" : "Expand"}</span>
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform duration-150",
                    showThinking ? "rotate-180" : "rotate-0"
                  )}
                />
              </span>
            </div>
          </button>
          {showThinking && (
            <div
              id={reasoningId}
              className="mt-2 max-h-56 overflow-y-auto rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
                <MarkdownRenderer content={msg.thinking ?? ""} />
              </div>
            </div>
          )}
        </section>
      )}
      <div className="prose prose-sm prose-gray max-w-none dark:prose-invert">
        <MarkdownRenderer content={msg.content} />
        {isLoading && !isUser && (
          <ChatMessageLoadingIndicator
            label={loadingLabel}
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
