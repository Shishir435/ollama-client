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
          className="group mb-3 overflow-hidden rounded-xl border border-border/50 bg-muted/30 transition-all duration-200 hover:border-border/80 hover:bg-muted/50">
          <button
            type="button"
            id={reasoningButtonId}
            aria-expanded={showThinking}
            aria-controls={reasoningId}
            className="flex w-full flex-col gap-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              setShowThinking((prev) => !prev)
              setUserToggledThinking(true)
            }}>
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex size-6 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20">
                  <Brain className="size-3.5" />
                </div>
                <span className="text-xs font-semibold tracking-tight text-foreground/90">
                  Thought Process
                </span>
              </div>

              <div className="flex items-center gap-3">
                {showThinkingIndicator ? (
                  <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                    </span>
                    Thinking…
                  </div>
                ) : (
                  !isStreaming &&
                  !isLoading && (
                    <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
                      Done
                    </span>
                  )
                )}
                <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                  {showThinking ? "Hide" : "Explore"}
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform duration-300 ease-in-out",
                      showThinking ? "rotate-180" : "rotate-0"
                    )}
                  />
                </div>
              </div>
            </div>

            {!showThinking && thinkingPreview && (
              <div className="ml-8 pr-4">
                <p className="line-clamp-1 text-[11px] leading-relaxed text-muted-foreground/70 italic">
                  &ldquo;{thinkingPreview.replace(/^Thinking Process:?\s*/i, "")}&rdquo;
                </p>
              </div>
            )}
          </button>
          {showThinking && (
            <div
              id={reasoningId}
              className="mt-0 border-t border-border/40 bg-muted/10">
              <div className="max-h-56 overflow-y-auto px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground/90">
                <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-headings:my-2 prose-code:rounded prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5">
                  <MarkdownRenderer content={msg.thinking ?? ""} />
                </div>
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
